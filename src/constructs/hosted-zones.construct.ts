import { Construct } from 'constructs';
import * as _ec2 from 'aws-cdk-lib/aws-ec2';
import * as _route53 from 'aws-cdk-lib/aws-route53';
import * as shared from '@src/shared';

interface IHostedZonesProps {
  vpc: _ec2.Vpc;
}

export interface IHostedZones {
  public: _route53.IHostedZone;
  private: _route53.HostedZone;
}

export class HostedZones extends Construct {
  public hostedZones: IHostedZones;

  constructor(scope: Construct, props: IHostedZonesProps) {
    super(scope, 'HostedZones');

    /*********
     * Public Hosted Zone
     *********/
    const publicHostedZone = _route53.HostedZone.fromLookup(scope, 'LookupPublicHostedZone', {
      domainName: shared.appConfig.domain,
    });

    /*********
     * Private Hosted Zone
     *********/
    const privateHostedZone = new _route53.PrivateHostedZone(
      scope,
      `PrivateHostedZone${shared.domainNames.private.replace('.', '')}`,
      {
        zoneName: shared.domainNames.private,
        comment: `Private HostedZone for ${shared.domainNames.private}`,
        vpc: props.vpc,
      },
    );

    /*********
     * OUTPUTS
     *********/
    this.hostedZones = {
      public: publicHostedZone,
      private: privateHostedZone,
    };
  }
}
