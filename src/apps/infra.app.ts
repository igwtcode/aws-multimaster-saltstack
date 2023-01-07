#!/usr/bin/env node

import 'source-map-support/register';
import * as _cdk from 'aws-cdk-lib';
import * as stacks from '@src/stacks';

const app = new _cdk.App();
new stacks.Infra(app);
