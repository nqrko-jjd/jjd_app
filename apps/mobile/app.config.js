const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const candidate = process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, 'google-services.json');
  const configured = fs.existsSync(candidate);
  return {
    ...config,
    android: { ...config.android, ...(configured ? { googleServicesFile: candidate } : {}) },
    extra: { ...config.extra, nativePushConfigured: configured },
  };
};
