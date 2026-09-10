// 订单模块共享展示函数（OrderList / OrderFormDialog / OrderDetailDialog 共用）
import { ORDER_TYPE_TEXT } from '@/utils/constants'

export const formatMoney = (value) => {
  if (!value && value !== 0) return '0.00'
  return Number(value).toFixed(2)
}

export const getOrderTypeText = (type) => ORDER_TYPE_TEXT[type] || '未知'

export const getOrderTypeTagType = (type) => {
  const map = {
    1: 'primary',
    2: 'success',
    3: 'warning',
    4: 'info',
    5: 'danger',
    6: 'info'
  }
  return map[type] || 'info'
}

export const getDeliveryMethodText = (method) => {
  const map = {
    1: '自有员工配送',
    2: '水站配送',
    3: '无需配送'
  }
  return map[method] || '未知'
}
