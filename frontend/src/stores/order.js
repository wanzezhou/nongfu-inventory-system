import { defineStore } from 'pinia'

/**
 * 订单模块的跨组件通知（2026-09-16）
 *
 * 场景：全局悬浮「新建订单」按钮（components/FloatingCreateOrder.vue）挂在 MainLayout 上，
 *       与订单列表页（OrderList.vue）是两个互不感知的组件。从悬浮按钮下单成功后，
 *       若订单列表正在显示，需要刷新它的表格。
 *
 * 做法：由一个自增的 savedTick 充当信号，列表页 watch 它并重新拉数据。
 *       不用事件总线（项目无 mitt 依赖），也不引入全局 window 事件。
 */
export const useOrderStore = defineStore('order', {
  state: () => ({
    /** 每次保存订单自增；列表页监听其变化以刷新 */
    savedTick: 0,
    /** 最近一次保存的订单号（便于列表页定位/提示，可为空） */
    lastSavedId: null
  }),
  actions: {
    /** 订单保存成功后调用（携带订单号，便于消费方定位） */
    notifyOrderSaved(orderId = null) {
      this.lastSavedId = orderId || null
      this.savedTick += 1
    }
  }
})
