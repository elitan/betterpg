import * as path from 'path';
import * as os from 'os';
import { CLI_NAME } from '../config/constants';

const homeDir = os.homedir();

export const PATHS = {
  CONFIG: path.join(homeDir, '.config', CLI_NAME, 'config.yaml'),
  STATE: path.join(homeDir, '.local', 'share', CLI_NAME, 'state.json'),
  WAL_ARCHIVE: path.join(homeDir, '.local', 'share', CLI_NAME, 'wal-archive'),
  CONFIG_DIR: path.join(homeDir, '.config', CLI_NAME),
  DATA_DIR: path.join(homeDir, '.local', 'share', CLI_NAME),
};
