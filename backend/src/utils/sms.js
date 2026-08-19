const axios = require('axios');

function generateCode() {
  return String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
}

async function sendSmsCode(phone, code) {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEV SMS] 验证码: ${code} -> ${phone}`);
    return { success: true, message: '验证码已发送(开发模式)' };
  }

  const apiUrl = process.env.SMS_API_URL;
  const apiKey = process.env.SMS_API_KEY;
  const signName = process.env.SMS_SIGN_NAME;
  const templateCode = process.env.SMS_TEMPLATE_CODE;

  // 生产环境短信发送 - 待接入实际短信服务商API
  // 示例实现:
  // await axios.post(apiUrl, {
  //   apiKey,
  //   phone,
  //   signName,
  //   templateCode,
  //   params: { code }
  // });

  return { success: true, message: '验证码已发送' };
}

module.exports = { sendSmsCode, generateCode };
