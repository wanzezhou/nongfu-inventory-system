require('dotenv').config();
const { pool } = require('../config/db');
(async () => {
  const [cols] = await pool.query('DESCRIBE mini_accounts');
  console.log('=== mini_accounts columns ===');
  cols.forEach(c => console.log(c.Field, c.Type, c.Null, c.Key, c.Default));
  const [idx] = await pool.query("SHOW INDEX FROM mini_accounts WHERE Key_name='idx_username'");
  console.log('=== idx_username ===');
  idx.length === 0 ? console.log('(无)') : idx.forEach(i => console.log(i.Table, i.Key_name, i.Column_name, i.Non_unique));
  process.exit(0);
})();
