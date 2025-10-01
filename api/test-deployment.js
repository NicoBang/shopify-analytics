// Test endpoint to verify deployment
module.exports = async function handler(req, res) {
  return res.status(200).json({
    success: true,
    message: 'Deployment working!',
    timestamp: new Date().toISOString(),
    version: '1.0.1-test'
  });
};
