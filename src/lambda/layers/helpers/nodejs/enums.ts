export { INSTANCE_TIER, TAG_NAME } from '@src/shared/enums';

export enum INSTANCE_STATE {
  PENDING = 'pending',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
  SHUTTINGDOWN = 'shutting-down',
  TERMINATED = 'terminated',
}
