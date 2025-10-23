import * as path from 'path';
import * as os from 'os';
import { CLI_NAME } from '../config/constants';

const homeDir = os.homedir();
const pgdDir = path.join(homeDir, `.${CLI_NAME}`);

export const PATHS = {
  STATE: path.join(pgdDir, 'state.json'),
  WAL_ARCHIVE: path.join(pgdDir, 'wal-archive'),
  DATA_DIR: pgdDir,
  BASE_DIR: pgdDir,
};
