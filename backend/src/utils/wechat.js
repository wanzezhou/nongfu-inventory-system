const axios = require('axios');
const crypto = require('crypto');

const APPID = process.env.WX_APPID;
const SECRET = process.env.WX_SECRET;

async function code2session(code) {
  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${APPID}&secret=${SECRET}&js_code=${code}&grant_type=authorization_code`;
  const response = await axios.get(url);
  const data = response.data;
  if (data.errcode) {
    throw new Error(`微信登录失败: ${data.errcode} ${data.errmsg || ''}`);
  }
  return {
    openid: data.openid,
    sessionKey: data.session_key,
    unionid: data.unionid
  };
}

function decryptData(sessionKey, encryptedData, iv) {
  const key = Buffer.from(sessionKey, 'base64');
  const ivBuffer = Buffer.from(iv, 'base64');
  const encrypted = Buffer.from(encryptedData, 'base64');

  const decipher = crypto.createDecipheriv('aes-128-cbc', key, ivBuffer);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { code2session, decryptData };
