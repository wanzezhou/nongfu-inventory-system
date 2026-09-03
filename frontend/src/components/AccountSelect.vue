<script setup>
import { formatMoney } from '@/utils/format'

/**
 * 公司账户选择下拉（D8：统一 InventoryList 入库/盘库、工资发放、其他支出的账户选择）
 * accounts 行结构：{ accountId, accountName, currentBalance, status }
 */
defineProps({
  modelValue: { type: [String, Number], default: '' },
  accounts: { type: Array, default: () => [] },
  placeholder: { type: String, default: '请选择公司账户' },
  /** 括号内余额文案：可用余额 / 可用 / 余额 */
  balanceLabel: { type: String, default: '可用余额' },
  clearable: { type: Boolean, default: false },
  /** 额外禁用判断，如 (a) => a.currentBalance < total */
  isDisabled: { type: Function, default: null }
})

defineEmits(['update:modelValue', 'change'])
</script>

<template>
  <el-select
    :model-value="modelValue"
    :placeholder="placeholder"
    :clearable="clearable"
    filterable
    style="width: 100%"
    @update:model-value="(v) => emit('update:modelValue', v)"
    @change="(v) => emit('change', v)"
  >
    <el-option
      v-for="a in accounts"
      :key="a.accountId"
      :label="`${a.accountName}（${balanceLabel} ¥${formatMoney(a.currentBalance)}）`"
      :value="a.accountId"
      :disabled="isDisabled ? isDisabled(a) : false"
    />
  </el-select>
</template>
