import * as path from 'path';
import * as os from 'os';

const homeDir = os.homedir();

export const PATHS = {
  CONFIG: path.join(homeDir, '.config', 'betterpg', 'config.yaml'),
  STATE: path.join(homeDir, '.local', 'share', 'betterpg', 'state.json'),
  WAL_ARCHIVE: path.join(homeDir, '.local', 'share', 'betterpg', 'wal-archive'),
  CONFIG_DIR: path.join(homeDir, '.config', 'betterpg'),
  DATA_DIR: path.join(homeDir, '.local', 'share', 'betterpg'),
};
