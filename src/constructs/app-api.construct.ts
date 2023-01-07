import { Construct } from 'constructs';
import * as path from 'path';
import * as _cdk from 'aws-cdk-lib';
import * as _ec2 from 'aws-cdk-lib/aws-ec2';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _lambda from 'aws-cdk-lib/aws-lambda';
import * as _route53 from 'aws-cdk-lib/aws-route53';
import * as _dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as _apigateway from 'aws-cdk-lib/aws-apigateway';
import * as _acm from 'aws-cdk-lib/aws-certificatemanager';
import * as _route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as _lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as constructs from '@src/constructs';
import * as shared from '@src/shared';

interface IAppApiProps {
  kmsKey: _kms.Key;
  instanceInfoTable: _dynamodb.Table;
  vpc: _ec2.Vpc;
  subnetSelections: constructs.IVpcSubnetSelections;
  securityGroups: constructs.ISecurityGroups;
  hostedZones: constructs.IHostedZones;
  lambdaLayers: constructs.ILambdaLayers;
  saltApiSsmParameters: constructs.ISaltApiCredentialsSsmParameters;
}

export class AppApi extends Construct {
  constructor(scope: Construct, props: IAppApiProps) {
    super(scope, 'AppApi');

    /*********
     * API GATEWAY REST API
     *********/
    const appApiCertificate = new _acm.DnsValidatedCertificate(scope, 'AppApiCertificate', {
      certificateName: `app-api-${shared.appConfig.env}`,
      hostedZone: props.hostedZones.public,
      domainName: shared.domainNames.appApi,
      cleanupRoute53Records: true,
      region: shared.appConfig.region,
      validation: _acm.CertificateValidation.fromDns(props.hostedZones.public),
    });

    const api = new _apigateway.RestApi(scope, 'AppRestApi', {
      restApiName: `app-api-${shared.appConfig.env}`,
      deploy: true,
      deployOptions: {
        stageName: shared.appConfig.env,
        cachingEnabled: false,
        metricsEnabled: true,
        throttlingRateLimit: 10,
      },
      disableExecuteApiEndpoint: true,
      apiKeySourceType: _apigateway.ApiKeySourceType.HEADER,
      domainName: {
        domainName: shared.domainNames.appApi,
        certificate: appApiCertificate,
        endpointType: _apigateway.EndpointType.REGIONAL,
      },
      endpointTypes: [_apigateway.EndpointType.REGIONAL],
    });
    const usagePlan = api.addUsagePlan('AppApiUsagePlan', {
      name: `usage-plan-${shared.appConfig.env}`,
      description: `Usage plan for ${shared.appConfig.env} environment`,
      quota: { limit: 1000, period: _apigateway.Period.MONTH },
      throttle: { rateLimit: 10, burstLimit: 100 },
    });
    const apiKey = api.addApiKey('AppUsagePlanApiKey', {
      apiKeyName: `app-usage-plan-api-key-${shared.appConfig.env}`,
      value: shared.appConfig.appApiKey,
    });
    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({ stage: api.deploymentStage });

    const record = new _route53.ARecord(scope, `AppRestApiRoute53Record${shared.domainNames.appApi.replace('.', '')}`, {
      recordName: shared.domainNames.appApi,
      zone: props.hostedZones.public,
      ttl: _cdk.Duration.hours(3),
      target: _route53.RecordTarget.fromAlias(new _route53Targets.ApiGateway(api)),
    });

    shared.setValueInScript('api', [
      { key: 'XAPIKEY', value: shared.appConfig.appApiKey },
      { key: 'API_DOMAIN_NAME', value: shared.domainNames.appApi },
    ]);

    const appApiInstancesResource = api.root.addResource('instances');

    const scanTableLambdaFunc = new _lambdaNodejs.NodejsFunction(scope, 'ScanInstanceInfoTableLambdaFunction', {
      ...shared.lambdaProps,
      layers: [props.lambdaLayers.helpers],
      functionName: `scan-instance-info-table-${shared.appConfig.env}`,
      entry: path.join(__dirname, '..', 'lambda', 'functions', 'api', 'scan-table.ts'),
      vpc: props.vpc,
      vpcSubnets: props.subnetSelections.isolated,
      securityGroups: [props.securityGroups.outboundHttps],
    });
    const scanTableLambdaAlias = new _lambda.Alias(scope, 'ScanInstanceInfoTableLambdaFunctionAlias', {
      aliasName: shared.appConfig.env,
      version: scanTableLambdaFunc.currentVersion,
    });
    scanTableLambdaAlias.addAutoScaling({ minCapacity: 0, maxCapacity: 3 });
    props.instanceInfoTable.grantReadData(scanTableLambdaAlias);
    appApiInstancesResource.addCorsPreflight({ allowOrigins: ['*'] });
    appApiInstancesResource.addMethod('GET', new _apigateway.LambdaIntegration(scanTableLambdaAlias), {
      apiKeyRequired: true,
    });

    const appApiSaltResource = api.root.addResource('salt');

    const saltPingLambdaFunc = new _lambdaNodejs.NodejsFunction(scope, 'SaltPingLambdaFunction', {
      ...shared.lambdaProps,
      layers: [props.lambdaLayers.helpers, props.lambdaLayers.httpUtils],
      functionName: `salt-ping-${shared.appConfig.env}`,
      entry: path.join(__dirname, '..', 'lambda', 'functions', 'api', 'salt-ping.ts'),
      vpc: props.vpc,
      vpcSubnets: props.subnetSelections.isolated,
      securityGroups: [props.securityGroups.lambdaWithSaltApiAlbAccess],
    });
    saltPingLambdaFunc.addEnvironment('SALT_API_URL', `https://${shared.domainNames.saltApi}`);
    saltPingLambdaFunc.addEnvironment('SALT_API_USERNAME', props.saltApiSsmParameters.username.stringValue);
    saltPingLambdaFunc.addEnvironment('SALT_API_PASSWORD', props.saltApiSsmParameters.password.stringValue);

    const saltPingLambdaAlias = new _lambda.Alias(scope, 'SaltPingLambdaFunctionAlias', {
      aliasName: shared.appConfig.env,
      version: saltPingLambdaFunc.currentVersion,
    });
    saltPingLambdaAlias.addAutoScaling({ minCapacity: 0, maxCapacity: 3 });
    props.instanceInfoTable.grantReadWriteData(saltPingLambdaAlias);
    appApiSaltResource.addCorsPreflight({ allowOrigins: ['*'] });
    appApiSaltResource.addMethod('GET', new _apigateway.LambdaIntegration(saltPingLambdaAlias), {
      apiKeyRequired: true,
    });
  }
}
