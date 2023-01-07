import { Construct } from 'constructs';
import * as _cdk from 'aws-cdk-lib';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _iam from 'aws-cdk-lib/aws-iam';
import * as shared from '@src/shared';

export class KmsKey extends Construct {
  public kmsKey: _kms.Key;

  constructor(scope: Construct) {
    super(scope, 'KmsKey');

    const key = new _kms.Key(this, 'KmsKey', {
      alias: `kmsKey-${shared.appConfig.env}`,
      description: 'Kms key for data encryption at rest',
      enabled: true,
      enableKeyRotation: true,
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
      pendingWindow: _cdk.Duration.days(7),
    });

    key.grantAdmin(_iam.User.fromUserName(this, 'GetCdkIamUser', shared.appConfig.username));

    /*********
     * OUTPUTS
     *********/
    this.kmsKey = key;
  }
}
