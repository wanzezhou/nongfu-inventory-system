<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="打印预览"
    width="650px"
    :close-on-click-modal="false"
    destroy-on-close
    class="print-dialog"
  >
    <div class="print-preview">
      <div class="print-content" ref="printContent">
        <div class="print-header">
          <h1>南京市晟之溪商贸有限公司（销售单）</h1>
        </div>
        
        <div class="print-info">
          <table class="info-table">
            <tr>
              <td class="info-label">客户名称:</td>
              <td class="info-value">{{ order.customerName }}</td>
              <td class="info-label">创建人:</td>
              <td class="info-value">{{ order.createdByName || '-' }}</td>
              <td class="info-label">单据编号:</td>
              <td class="info-value">{{ order.orderNo }}</td>
            </tr>
            <tr>
              <td class="info-label">联系电话:</td>
              <td class="info-value">{{ order.customerPhone || '-' }}</td>
              <td class="info-label">打印时间:</td>
              <td class="info-value">{{ printTime }}</td>
              <td class="info-label"></td>
              <td class="info-value"></td>
            </tr>
            <tr>
              <td class="info-label">公司地址:</td>
              <td class="info-value" colspan="5">{{ order.customerAddress || '-' }}</td>
            </tr>
          </table>
        </div>
        
        <div class="print-table">
          <table>
            <thead>
              <tr>
                <th>行号</th>
                <th>商品名称</th>
                <th>规格</th>
                <th>单位</th>
                <th>数量</th>
                <th v-if="!noPrice">单价</th>
                <th v-if="!noPrice">金额</th>
                <th>回桶</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in order.items" :key="index">
                <td>{{ index + 1 }}</td>
                <td class="product-name">{{ item.productName }}</td>
                <td>{{ item.spec }}</td>
                <td>{{ item.unit || '-' }}</td>
                <td align="center">{{ item.quantity }}</td>
                <!-- 水票抵扣商品：不显示单价，显示“水票抵扣”（2026-08-27） -->
                <td v-if="!noPrice" align="center">
                  <template v-if="isTicketItem(item)">水票抵扣</template>
                  <template v-else>{{ formatMoney(item.unitPrice) }}</template>
                </td>
                <td v-if="!noPrice" align="right">{{ formatMoney(item.subtotal) }}</td>
                <td></td>
              </tr>
              <tr class="total-row">
                <!-- 送水到府/机台供货：不显示金额（单价为进货价口径，2026-09-07） -->
                <td colspan="4">合计：{{ noPrice ? '--' : totalAmountChinese }}</td>
                <td align="center">{{ totalQuantity }}</td>
                <td v-if="!noPrice"></td>
                <td v-if="!noPrice" align="right">{{ formatMoney(order.orderAmount) }}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        
        <div class="print-footer">
          <div class="footer-left">
            <div class="footer-row">
              <span class="label">司机:</span>
              <span class="value">{{ order.deliveryStaff || '-' }}</span>
            </div>
            <div class="footer-row">
              <span class="label">店长联系电话:</span>
              <span class="value">{{ order.managerPhone || '-' }}</span>
            </div>
          </div>
          <div class="footer-right">
            <span class="label">收货单位创建人：</span>
            <span class="signature">（签字）</span>
          </div>
        </div>
      </div>
    </div>
    
    <template #footer>
      <el-button @click="$emit('update:visible', false)">关闭</el-button>
      <el-button type="primary" @click="handlePrint">打印</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { formatMoney } from '@/utils/format'
import { ref, computed, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  order: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:visible'])

const printContent = ref(null)
const printTime = ref('')

watch(() => props.visible, (val) => {
  if (val) {
    const now = new Date()
    printTime.value = now.toISOString().slice(0, 10)
  }
})

// 水票抵扣行：直营水站销售(类型2) 且行内使用水票抵扣（pricingType=2 或 ticketQty>0）
const isTicketItem = (item) => {
  return Number(props.order.orderType) === 2 && (Number(item.pricingType) === 2 || Number(item.ticketQty) > 0)
}

// 送水到府(1)/量贩机供货(4)/零售机供货(6)：不显示单价与金额（与详情弹窗口径一致）
const noPrice = computed(() => [1, 4, 6].includes(Number(props.order.orderType)))

const totalQuantity = computed(() => {
  return (props.order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0)
})

const totalAmountChinese = computed(() => {
  const amount = Number(props.order.orderAmount || 0)
  return convertToChinese(amount)
})

const convertToChinese = (num) => {
  const units = ['元', '角', '分']
  const bigDigits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const bigUnits = ['', '拾', '佰', '仟', '万', '拾', '佰', '仟', '亿']
  
  const parts = num.toFixed(2).split('.')
  const integerPart = parts[0]
  const decimalPart = parts[1]
  
  let result = ''
  
  for (let i = 0; i < integerPart.length; i++) {
    const digit = parseInt(integerPart[i])
    const unitIndex = integerPart.length - 1 - i
    if (digit === 0) {
      if (i < integerPart.length - 1 && parseInt(integerPart[i + 1]) !== 0) {
        result += bigDigits[0]
      }
    } else {
      result += bigDigits[digit] + bigUnits[unitIndex]
    }
  }
  
  result += units[0]
  
  if (decimalPart === '00') {
    result += '整'
  } else {
    const jiao = parseInt(decimalPart[0])
    const fen = parseInt(decimalPart[1])
    if (jiao !== 0) {
      result += bigDigits[jiao] + units[1]
    }
    if (fen !== 0) {
      result += bigDigits[fen] + units[2]
    }
  }
  
  return result
}

const handlePrint = () => {
  const printWindow = window.open('', '_blank')
  const content = printContent.value.innerHTML
  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>订单打印</title>
      <style>
        @page {
          size: 241mm 279mm;
          margin: 5mm 5mm 5mm 5mm;
        }
        body {
          font-family: '宋体', SimSun, serif;
          font-size: 14px;
          line-height: 1.6;
          margin: 0;
          padding: 0;
        }
        .print-content {
          width: 100%;
          max-width: 230mm;
        }
        .print-header h1 {
          text-align: center;
          font-size: 18px;
          font-weight: bold;
          margin: 0 0 12px 0;
          padding-bottom: 8px;
          border-bottom: 1px solid #000;
        }
        .print-info {
          margin-bottom: 8px;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .info-table td {
          padding: 2px 4px;
          vertical-align: top;
        }
        .info-table .info-label {
          font-weight: bold;
          white-space: nowrap;
          width: 70px;
        }
        .info-table .info-value {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }
        .print-table {
          margin-top: 8px;
        }
        .print-table table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .print-table th, .print-table td {
          border: 1px solid #000;
          padding: 5px 4px;
          text-align: left;
        }
        .print-table th {
          font-weight: bold;
          text-align: center;
        }
        .print-table th:nth-child(1) { width: 36px; }
        .print-table th:nth-child(2) { width: auto; }
        .print-table th:nth-child(3) { width: 70px; }
        .print-table th:nth-child(4) { width: 45px; }
        .print-table th:nth-child(5) { width: 50px; }
        .print-table th:nth-child(6) { width: 60px; }
        .print-table th:nth-child(7) { width: 60px; }
        .print-table th:nth-child(8) { width: 50px; }
        .product-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .total-row {
          font-weight: bold;
        }
        .print-footer {
          display: flex;
          justify-content: space-between;
          margin-top: 15px;
          padding-top: 10px;
          border-top: 1px dashed #000;
        }
        .footer-left {
          flex: 1;
        }
        .footer-row {
          margin-bottom: 3px;
        }
        .footer-row .label {
          font-weight: bold;
          min-width: 50px;
        }
        .footer-right {
          text-align: right;
        }
        .signature {
          border-bottom: 1px solid #000;
          padding: 0 30px;
        }
        @media print {
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      ${content}
    </body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}
</script>

<style scoped>
.print-dialog {
  max-height: 90vh;
  overflow: hidden;
}

.print-preview {
  max-height: 70vh;
  overflow-y: auto;
  padding: 10px;
}

.print-content {
  font-family: '宋体', SimSun, serif;
  font-size: 14px;
  line-height: 1.5;
}

.print-header h1 {
  text-align: center;
  font-size: 18px;
  font-weight: bold;
  margin: 0 0 15px 0;
}

.print-info {
  margin-bottom: 10px;
}

.info-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.info-table td {
  padding: 3px 4px;
  vertical-align: top;
}

.info-table .info-label {
  font-weight: bold;
  white-space: nowrap;
  width: 70px;
}

.info-table .info-value {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.print-table table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10px;
  font-size: 13px;
}

.print-table th, .print-table td {
  border: 1px solid #000;
  padding: 6px 4px;
  text-align: left;
}

.print-table th {
  background-color: var(--bg);
  font-weight: bold;
}

.product-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.total-row {
  font-weight: bold;
}

.print-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 20px;
}

.footer-row {
  margin-bottom: 4px;
}

.footer-row .label {
  font-weight: bold;
}

.footer-right {
  text-align: right;
}

.signature {
  border-bottom: 1px solid #000;
  padding: 0 30px;
}
</style>