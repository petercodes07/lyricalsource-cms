const { workspaceUrl } = require('./policy');
const SHARED_WORKSPACE = workspaceUrl('https://lyricalsourcecom.dbm.shared-servers.com/cms');
function startupWorkspace({ packaged = true, args = [] } = {}) {
  return !packaged && (args.includes('--demo') || args.includes('--ssh-workspace'))
    ? 'http://127.0.0.1:3100' : SHARED_WORKSPACE;
}
module.exports = { SHARED_WORKSPACE, startupWorkspace };
