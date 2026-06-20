// In-memory active session tracker
// Key: userId (string), Value: { token, loginTime }
const activeSessions = new Map();
module.exports = activeSessions;
