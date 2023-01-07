import { Construct } from 'constructs';
import * as path from 'path';
import * as _cdk from 'aws-cdk-lib';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import * as shared from '@src/shared';

export interface ILambdaLayers {
  httpUtils: _lambda.LayerVersion;
  helpers: _lambda.LayerVersion;
}

export class LambdaLayers extends Construct {
  public lambdaLayers: ILambdaLayers;

  constructor(scope: Construct) {
    super(scope, 'LambdaLayers');

    /*********
     * Http Utils Layer
     *********/
    const httpUtils = new _lambda.LayerVersion(this, 'LambdaLayerHttpUtils', {
      layerVersionName: `http-utils-${shared.appConfig.env}`,
      description: 'npm modules for http requests',
      compatibleArchitectures: [_lambda.Architecture.X86_64],
      compatibleRuntimes: [_lambda.Runtime.NODEJS_16_X],
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
      code: _lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'layers', 'http-utils')),
    });

    /*********
     * Helpers Layer
     *********/
    const helpers = new _lambda.LayerVersion(this, 'LambdaLayerHelpers', {
      layerVersionName: `helpers-${shared.appConfig.env}`,
      description: 'helper functions, enums, constants and variables',
      compatibleArchitectures: [_lambda.Architecture.X86_64],
      compatibleRuntimes: [_lambda.Runtime.NODEJS_16_X],
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
      code: _lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda', 'layers', 'helpers')),
    });

    /*********
     * OUTPUTS
     *********/
    this.lambdaLayers = {
      httpUtils,
      helpers,
    };
  }
}
