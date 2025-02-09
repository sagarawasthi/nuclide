'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

import type {
  NuclideRemoteConnectionParams,
  NuclideRemoteConnectionProfile,
} from './connection-types';

import type {SshHandshakeErrorType} from '../../remote-connection/lib/SshHandshake';

import {notifySshHandshakeError} from './notification';
import AuthenticationPrompt from './AuthenticationPrompt';
import ConnectionDetailsPrompt from './ConnectionDetailsPrompt';
import IndeterminateProgressBar from './IndeterminateProgressBar';
import React from 'react-for-atom';
import {
  SshHandshake,
  decorateSshConnectionDelegateWithTracking,
} from '../../remote-connection';
const logger = require('../../logging').getLogger();

type DefaultProps = {};
type Props = {
  // The list of connection profiles that will be displayed.
  connectionProfiles: ?Array<NuclideRemoteConnectionProfile>;
  // If there is >= 1 connection profile, this index indicates the initial
  // profile to use.
  indexOfInitiallySelectedConnectionProfile: ?number;
  // Function that is called when the "+" button on the profiles list is clicked.
  // The user's intent is to create a new profile.
  onAddProfileClicked: () => mixed;
  // Function that is called when the "-" button on the profiles list is clicked
  // ** while a profile is selected **.
  // The user's intent is to delete the currently-selected profile.
  onDeleteProfileClicked: (indexOfSelectedConnectionProfile: number) => mixed;
  onConnect: () => mixed;
  onError: () => mixed;
  onCancel: () => mixed;
  onClosed: ?() => mixed;
};
type State = {
  mode: number;
  instructions: string;
  sshHandshake: SshHandshake;
  finish: (answers: Array<string>) => mixed;
};

const REQUEST_CONNECTION_DETAILS = 1;
const WAITING_FOR_CONNECTION = 2;
const REQUEST_AUTHENTICATION_DETAILS = 3;
const WAITING_FOR_AUTHENTICATION = 4;

/**
 * Component that manages the state transitions as the user connects to a
 * server.
 */
/* eslint-disable react/prop-types */
export default class ConnectionDialog extends React.Component<DefaultProps, Props, State> {
  _boundOk: () => void;
  _boundCancel: () => void;

  constructor(props: Props) {
    super(props);
    this.state = this._createInitialState();
    this._boundOk = this.ok.bind(this);
    this._boundCancel = this.cancel.bind(this);
  }

  _createInitialState() {
    const sshHandshake = new SshHandshake(decorateSshConnectionDelegateWithTracking({
      onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish)  => {
        // TODO: Display all prompts, not just the first one.
        this.requestAuthentication(prompts[0], finish);
      },

      onWillConnect:() => {},

      onDidConnect: (connection: SshHandshake, config: SshConnectionConfiguration) => {
        this.close(); // Close the dialog.
        this.props.onConnect(connection, config);
      },

      onError: (
        errorType: SshHandshakeErrorType,
        error: Error,
        config: SshConnectionConfiguration,
      ) => {
        this.close(); // Close the dialog.
        notifySshHandshakeError(errorType, error, config);
        this.props.onError(error, config);
        logger.debug(error);
      },
    }));

    return {
      mode: REQUEST_CONNECTION_DETAILS,
      instructions: '',
      sshHandshake: sshHandshake,
      finish: (answers) => {},
    };
  }

  render() {
    const mode = this.state.mode;
    let content;
    let isOkDisabled;
    if (mode === REQUEST_CONNECTION_DETAILS) {
      content = (
        <ConnectionDetailsPrompt
          ref="connection-details"
          connectionProfiles={this.props.connectionProfiles}
          indexOfInitiallySelectedConnectionProfile=
            {this.props.indexOfInitiallySelectedConnectionProfile}
          onAddProfileClicked={this.props.onAddProfileClicked}
          onDeleteProfileClicked={this.props.onDeleteProfileClicked}
          onConfirm={this._boundOk}
          onCancel={this._boundCancel}
        />
      );
      isOkDisabled = false;
    } else if (mode === WAITING_FOR_CONNECTION || mode === WAITING_FOR_AUTHENTICATION) {
      content = <IndeterminateProgressBar />;
      isOkDisabled = true;
    } else {
      content = (
        <AuthenticationPrompt ref="authentication"
                              instructions={this.state.instructions}
                              onConfirm={this._boundOk}
                              onCancel={this._boundCancel}
      />);
      isOkDisabled = false;
    }

    // The root element cannot have a 'key' property, so we use a dummy
    // <div> as the root. Ideally, the <atom-panel> would be the root.
    return (
      <div>
        <atom-panel class="modal from-top" key="connect-dialog">
          {content}
          <div className="block nuclide-ok-cancel">
            <button className="btn" onClick={this._boundCancel}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={this._boundOk} disabled={isOkDisabled}>
              OK
            </button>
          </div>
        </atom-panel>
      </div>
    );
  }

  cancel() {
    const mode = this.state.mode;

    // It is safe to call cancel even if no connection is started
    this.state.sshHandshake.cancel();

    if (mode === WAITING_FOR_CONNECTION) {
      // TODO(mikeo): Tell delegate to cancel the connection request.
      this.setState({mode: REQUEST_CONNECTION_DETAILS});
    } else {
      // TODO(mikeo): Also cancel connection request, as appropriate for mode?
      this.props.onCancel();
      this.close();
    }
  }

  close() {
    if (this.props.onClosed) {
      this.props.onClosed();
    }
  }

  ok() {
    const mode = this.state.mode;

    if (mode === REQUEST_CONNECTION_DETAILS) {
      // User is trying to submit connection details.
      const connectionDetailsForm = this.refs['connection-details'];
      const {
        username,
        server,
        cwd,
        remoteServerCommand,
        sshPort,
        pathToPrivateKey,
        authMethod,
        password,
      } = connectionDetailsForm.getFormFields();
      if (username && server && cwd && remoteServerCommand) {
        this.setState({mode: WAITING_FOR_CONNECTION});
        this.state.sshHandshake.connect({
          host: server,
          sshPort,
          username,
          pathToPrivateKey,
          authMethod,
          cwd,
          remoteServerCommand,
          password,
        });
      } else {
        // TODO(mbolin): Tell user to fill out all of the fields.
      }
    } else if (mode === REQUEST_AUTHENTICATION_DETAILS) {
      const authenticationPrompt = this.refs['authentication'];
      const password = authenticationPrompt.getPassword();

      this.state.finish([password]);

      this.setState({mode: WAITING_FOR_AUTHENTICATION});
    }
  }

  requestAuthentication(
    instructions: {echo: boolean; prompt: string},
    finish: (answers: Array<string>) => void
  ) {
    this.setState({
      mode: REQUEST_AUTHENTICATION_DETAILS,
      instructions: instructions.prompt,
      finish,
    });
  }

  getFormFields(): ?NuclideRemoteConnectionParams {
    const connectionDetailsForm = this.refs['connection-details'];
    if (!connectionDetailsForm) {
      return null;
    }
    const {
      username,
      server,
      cwd,
      remoteServerCommand,
      sshPort,
      pathToPrivateKey,
      authMethod,
    } = connectionDetailsForm.getFormFields();
    return {
      username,
      server,
      cwd,
      remoteServerCommand,
      sshPort,
      pathToPrivateKey,
      authMethod,
    };
  }
}
/* eslint-enable react/prop-types */
