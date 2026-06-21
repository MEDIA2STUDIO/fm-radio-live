// In-memory active session tracker (non-admin users only)
// Key: userId (string), Value: { token, loginTime }
const activeSessions = new Map();
module.exports = activeSessions;
