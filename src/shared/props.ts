import * as _cdk from 'aws-cdk-lib';
import * as _logs from 'aws-cdk-lib/aws-logs';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import * as _lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as shared from '@src/shared';

export const stackProps = {
  terminationProtection: false,
  env: {
    account: shared.appConfig.account,
    region: shared.appConfig.region,
  },
  tags: {
    [shared.TAG_NAME.PROJECT]: shared.appConfig.project,
    [shared.TAG_NAME.ENVIRONMENT]: shared.appConfig.env,
    [shared.TAG_NAME.SOURCE]: 'CDK',
  },
};

export const lambdaProps: _lambdaNodejs.NodejsFunctionProps = {
  handler: 'handler',
  runtime: _lambda.Runtime.NODEJS_16_X,
  bundling: { externalModules: ['aws-sdk', 'aws-lambda', 'axios'] },
  awsSdkConnectionReuse: true,
  architecture: _lambda.Architecture.X86_64,
  memorySize: 128,
  timeout: _cdk.Duration.minutes(3),
  logRetention: _logs.RetentionDays.ONE_DAY,
  environment: {
    APP_ENV: shared.appConfig.env,
    REGION: shared.appConfig.region,
  },
};
