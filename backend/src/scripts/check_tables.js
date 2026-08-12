require('dotenv').config();
const { pool } = require('../config/db');
(async () => {
  const [r1] = await pool.query("SHOW TABLES LIKE 'barrel_deposits'");
  const [r2] = await pool.query("SHOW TABLES LIKE 'reimbursements'");
  console.log('barrel_deposits:', r1.length > 0 ? 'EXISTS' : 'MISSING');
  console.log('reimbursements:', r2.length > 0 ? 'EXISTS' : 'MISSING');
  process.exit(0);
})();
