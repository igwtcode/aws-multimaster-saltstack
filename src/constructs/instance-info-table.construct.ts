import { Construct } from 'constructs';
import * as _cdk from 'aws-cdk-lib';
import * as _kms from 'aws-cdk-lib/aws-kms';
import * as _dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as shared from '@src/shared';

interface IInstanceInfoTableProps {
  kmsKey: _kms.Key;
}

export class InstanceInfoTable extends Construct {
  public instanceInfoTable: _dynamodb.Table;

  constructor(scope: Construct, props: IInstanceInfoTableProps) {
    super(scope, 'InstanceInfoTable');

    const table = new _dynamodb.Table(scope, 'InstanceInfoDynamoDBTable', {
      tableName: shared.instanceInfoTableConfig.tableName,
      partitionKey: {
        name: shared.instanceInfoTableConfig.partionKey,
        type: _dynamodb.AttributeType.STRING,
      },
      encryption: _dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.kmsKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: shared.instanceInfoTableConfig.ttlAttr,
      billingMode: _dynamodb.BillingMode.PROVISIONED,
      tableClass: _dynamodb.TableClass.STANDARD,
      removalPolicy: _cdk.RemovalPolicy.DESTROY,
      readCapacity: 1,
      writeCapacity: 1,
    });

    table.autoScaleReadCapacity({ minCapacity: 1, maxCapacity: 3 });
    table.autoScaleWriteCapacity({ minCapacity: 1, maxCapacity: 3 });

    /*********
     * OUTPUTS
     *********/
    this.instanceInfoTable = table;
  }
}
