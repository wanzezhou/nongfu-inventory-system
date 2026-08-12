const { pool } = require('../../config/db');
const { success, error, pagination } = require('../../utils/response');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 配送照片上传目录
const uploadDir = path.join(__dirname, '../../../uploads/delivery');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `del_${Date.now()}_${Math.random().toString(36).substr(2, 6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// 获取待接单的配送订单（自有员工配送，未分配 worker）
async function pending(req, res) {
  try {
    const sql = `SELECT
        o.order_id AS orderId,
        o.order_type AS orderType,
        o.customer_name AS customerName,
        o.customer_phone AS customerPhone,
        o.customer_address AS customerAddress,
        o.order_amount AS orderAmount,
        o.delivery_fee AS deliveryFee,
        o.created_at AS createdAt,
        w.worker_name AS creatorName
      FROM orders o
      LEFT JOIN workers w ON o.created_by = w.worker_id
      WHERE o.delivery_type = 1
        AND o.worker_id IS NULL
        AND o.order_status IN (0, 1)
      ORDER BY o.created_at DESC`;
    const [rows] = await pool.execute(sql);
    const list = rows.map(r => ({
      orderId: r.orderId,
      orderType: r.orderType,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      customerAddress: r.customerAddress,
      orderAmount: Number(r.orderAmount) || 0,
      deliveryFee: Number(r.deliveryFee) || 0,
      createdAt: r.createdAt,
      creatorName: r.creatorName || null
    }));
    return res.json({ code: 200, data: { list, total: list.length } });
  } catch (err) {
    console.error('获取待接单配送订单失败:', err);
    return res.json({ code: 500, message: '获取待接单配送订单失败: ' + err.message, data: null });
  }
}

// 接单（原子操作，防止并发抢单）
async function accept(req, res) {
  try {
    const { id } = req.params;
    const workerId = req.miniUser.targetId;
    if (!id) {
      return res.json({ code: 400, message: '缺少订单ID', data: null });
    }
    const sql = `UPDATE orders SET worker_id = ?, order_status = 1, updated_at = NOW()
      WHERE order_id = ? AND worker_id IS NULL AND order_status IN (0, 1)`;
    const [result] = await pool.execute(sql, [workerId, id]);
    if (result.affectedRows === 0) {
      return res.json({ code: 409, message: '订单已被接取或不存在', data: null });
    }
    return res.json({ code: 200, message: '接单成功', data: null });
  } catch (err) {
    console.error('接单失败:', err);
    return res.json({ code: 500, message: '接单失败: ' + err.message, data: null });
  }
}

// 完成配送（仅限分配的员工本人）
async function complete(req, res) {
  try {
    const { id } = req.params;
    const { photoUrl, remark } = req.body || {};
    if (!id) {
      return res.json({ code: 400, message: '缺少订单ID', data: null });
    }

    const [rows] = await pool.execute(
      'SELECT worker_id, order_status FROM orders WHERE order_id = ?',
      [id]
    );
    if (rows.length === 0) {
      return res.json({ code: 404, message: '订单不存在', data: null });
    }
    const order = rows[0];
    if (String(order.worker_id) !== String(req.miniUser.targetId)) {
      return res.json({ code: 403, message: '只有配送该订单的员工可以完成', data: null });
    }

    await pool.execute(
      'UPDATE orders SET order_status = 2, updated_at = NOW() WHERE order_id = ?',
      [id]
    );

    // photoUrl / remark 暂存于日志（无对应表时忽略），保留参数以备后续扩展
    if (photoUrl || remark) {
      console.log(`[delivery complete] order=${id} photoUrl=${photoUrl || ''} remark=${remark || ''}`);
    }

    return res.json({ code: 200, message: '配送完成', data: null });
  } catch (err) {
    console.error('完成配送失败:', err);
    return res.json({ code: 500, message: '完成配送失败: ' + err.message, data: null });
  }
}

// 我的配送订单（分页）
async function mine(req, res) {
  try {
    const { page = 1, pageSize = 20, status } = req.query;
    const workerId = req.miniUser.targetId;
    const currentPage = parseInt(page) || 1;
    const size = parseInt(pageSize) || 20;
    const offset = (currentPage - 1) * size;

    const whereParts = ['o.worker_id = ?'];
    const params = [workerId];

    if (status === 'pending') {
      whereParts.push('o.order_status = 1');
    } else if (status === 'completed') {
      whereParts.push('o.order_status = 2');
    }

    const whereClause = 'WHERE ' + whereParts.join(' AND ');

    const countSql = `SELECT COUNT(*) AS total FROM orders o ${whereClause}`;
    const [countRows] = await pool.execute(countSql, params);
    const total = countRows[0].total;

    const listSql = `SELECT
        o.order_id AS orderId,
        o.order_type AS orderType,
        o.customer_name AS customerName,
        o.customer_phone AS customerPhone,
        o.customer_address AS customerAddress,
        o.order_amount AS orderAmount,
        o.delivery_fee AS deliveryFee,
        o.total_receivable AS totalReceivable,
        o.order_status AS orderStatus,
        o.created_at AS createdAt,
        o.updated_at AS updatedAt,
        s.station_name AS stationName
      FROM orders o
      LEFT JOIN sub_stations s ON o.station_id = s.station_id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ${parseInt(size)} OFFSET ${parseInt(offset)}`;
    const [rows] = await pool.execute(listSql, params);

    const list = rows.map(r => ({
      orderId: r.orderId,
      orderType: r.orderType,
      customerName: r.customerName,
      customerPhone: r.customerPhone,
      customerAddress: r.customerAddress,
      orderAmount: Number(r.orderAmount) || 0,
      deliveryFee: Number(r.deliveryFee) || 0,
      totalReceivable: Number(r.totalReceivable) || 0,
      orderStatus: r.orderStatus,
      stationName: r.stationName || null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    return pagination(res, list, total, currentPage, size);
  } catch (err) {
    console.error('获取我的配送订单失败:', err);
    return res.json({ code: 500, message: '获取我的配送订单失败: ' + err.message, data: null });
  }
}

// 管理员分配订单给员工
async function assign(req, res) {
  try {
    const { orderId, workerId } = req.body || {};
    if (!orderId || !workerId) {
      return res.json({ code: 400, message: '订单ID和员工ID不能为空', data: null });
    }

    const [orderRows] = await pool.execute(
      'SELECT order_id FROM orders WHERE order_id = ?',
      [orderId]
    );
    if (orderRows.length === 0) {
      return res.json({ code: 404, message: '订单不存在', data: null });
    }

    const [workerRows] = await pool.execute(
      'SELECT worker_id FROM workers WHERE worker_id = ?',
      [workerId]
    );
    if (workerRows.length === 0) {
      return res.json({ code: 404, message: '员工不存在', data: null });
    }

    const [result] = await pool.execute(
      `UPDATE orders SET worker_id = ?, order_status = 1, updated_at = NOW()
       WHERE order_id = ? AND order_status IN (0, 1)`,
      [workerId, orderId]
    );
    if (result.affectedRows === 0) {
      return res.json({ code: 409, message: '订单状态不允许分配', data: null });
    }
    return res.json({ code: 200, message: '分配成功', data: null });
  } catch (err) {
    console.error('分配订单失败:', err);
    return res.json({ code: 500, message: '分配订单失败: ' + err.message, data: null });
  }
}

// 上传配送完成照片
async function uploadPhoto(req, res) {
  try {
    if (!req.file) {
      return res.json({ code: 400, message: '未接收到图片', data: null });
    }
    const url = `/uploads/delivery/${req.file.filename}`;
    return res.json({ code: 200, message: '上传成功', data: { url } });
  } catch (err) {
    console.error('上传照片失败:', err);
    return res.json({ code: 500, message: '上传照片失败: ' + err.message, data: null });
  }
}

module.exports = {
  pending,
  accept,
  complete,
  mine,
  assign,
  uploadPhoto,
  upload
};
