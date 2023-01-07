import { EventBridgeEvent } from 'aws-lambda';

export type IInstanceStateChangeEvent = EventBridgeEvent<
  'EC2 Instance State-change Notification',
  { state: string; 'instance-id': string }
>;

export interface IInstanceData {
  id: string;
  state: string;
  name: string;
  minionId: string;
  env: string;
  tier: string;
  privateIp: string;
  publicIp: string;
  updatedAt?: string;
}
