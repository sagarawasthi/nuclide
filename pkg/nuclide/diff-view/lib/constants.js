'use babel';
/* @flow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

const {StatusCodeNumber: HgStatusCodeNumber} = require('../../hg-repository-base').hgConstants;

import type {FileChangeStatusValue} from './types';

const FileChangeStatus: {[key: string]: FileChangeStatusValue} = {
  ADDED: 1,
  MODIFIED: 2,
  MISSING: 3,
  REMOVED: 4,
  UNTRACKED: 5,
};

const HgStatusToFileChangeStatus : {[key: HgStatusCodeNumber]: FileChangeStatus} = {
  [HgStatusCodeNumber.ADDED]: FileChangeStatus.ADDED,
  [HgStatusCodeNumber.MODIFIED]: FileChangeStatus.MODIFIED,
  [HgStatusCodeNumber.MISSING]: FileChangeStatus.MISSING,
  [HgStatusCodeNumber.REMOVED]: FileChangeStatus.REMOVED,
  [HgStatusCodeNumber.UNTRACKED]: FileChangeStatus.UNTRACKED,
};

const FileChangeStatusToPrefix: {[key: FileChangeStatusValue]: string} = {
  [FileChangeStatus.ADDED]: '[A] ',
  [FileChangeStatus.MODIFIED]: '[M] ',
  [FileChangeStatus.MISSING]: '[!] ',
  [FileChangeStatus.REMOVED]: '[D] ',
  [FileChangeStatus.UNTRACKED]: '[?] ',
};

module.exports = {
  FileChangeStatus,
  HgStatusToFileChangeStatus,
  FileChangeStatusToPrefix,
  HgStatusCodeNumber,
};
