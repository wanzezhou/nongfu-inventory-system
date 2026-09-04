import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '@/layout/MainLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { MENU_TITLES } from '@/layout/menuConfig'

// 菜单标题单一数据源：meta.title 从 layout/menuConfig.js 导入（A8），
// 新增页面只需在 menuConfig 里登记一处。meta.icon 已无消费方，随之移除。
const t = (key) => MENU_TITLES[`/${key}`]

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    redirect: '/dashboard'
  },
  {
    path: '/',
    component: MainLayout,
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/Dashboard.vue'),
        meta: { title: t('dashboard'), requiresAuth: true }
      },
      {
        path: 'salary',
        name: 'SalaryStatistics',
        component: () => import('@/views/statistics/SalaryStatistics.vue'),
        meta: { title: t('salary'), requiresAuth: true }
      },
      {
        path: 'cost/station',
        name: 'StationCost',
        component: () => import('@/views/cost/StationCost.vue'),
        meta: { title: t('cost/station'), requiresAuth: true }
      },
      {
        path: 'cost/summary',
        name: 'CostSummary',
        component: () => import('@/views/cost/CostSummary.vue'),
        meta: { title: t('cost/summary'), requiresAuth: true }
      },
      {
        path: 'cost/expenses',
        name: 'OtherExpenses',
        component: () => import('@/views/cost/OtherExpenses.vue'),
        meta: { title: t('cost/expenses'), requiresAuth: true }
      },
      {
        path: 'product',
        name: 'Product',
        component: () => import('@/views/product/ProductList.vue'),
        meta: { title: t('product'), requiresAuth: true }
      },
      {
        path: 'inventory',
        name: 'Inventory',
        component: () => import('@/views/inventory/InventoryList.vue'),
        meta: { title: t('inventory'), requiresAuth: true }
      },
      {
        path: 'order',
        name: 'Order',
        component: () => import('@/views/order/OrderList.vue'),
        meta: { title: t('order'), requiresAuth: true }
      },
      {
        path: 'station',
        name: 'Station',
        component: () => import('@/views/station/StationList.vue'),
        meta: { title: t('station'), requiresAuth: true }
      },
      {
        path: 'bulk-machine',
        name: 'BulkMachine',
        component: () => import('@/views/machine/MachineStationList.vue'),
        props: () => ({ machineType: 1, moduleTitle: '量贩机' }),
        meta: { title: t('bulk-machine'), requiresAuth: true }
      },
      {
        path: 'retail-machine',
        name: 'RetailMachine',
        component: () => import('@/views/machine/MachineStationList.vue'),
        props: () => ({ machineType: 2, moduleTitle: '零售机' }),
        meta: { title: t('retail-machine'), requiresAuth: true }
      },
      {
        path: 'supplier',
        name: 'Supplier',
        component: () => import('@/views/supplier/SupplierList.vue'),
        meta: { title: t('supplier'), requiresAuth: true }
      },
      {
        path: 'worker',
        name: 'Worker',
        component: () => import('@/views/worker/WorkerList.vue'),
        meta: { title: t('worker'), requiresAuth: true }
      },
      {
        path: 'salesman',
        name: 'Salesman',
        component: () => import('@/views/salesman/SalesmanList.vue'),
        meta: { title: t('salesman'), requiresAuth: true }
      },
      {
        path: 'accounts',
        name: 'CompanyAccounts',
        component: () => import('@/views/account/CompanyAccounts.vue'),
        meta: { title: t('accounts'), requiresAuth: true }
      },
      {
        path: 'statistics/product-sales',
        name: 'ProductSales',
        component: () => import('@/views/statistics/ProductSales.vue'),
        meta: { title: t('statistics/product-sales'), requiresAuth: true }
      },
      {
        path: 'finance',
        redirect: '/finance/platform'
      },
      {
        path: 'finance/platform',
        name: 'FinancePlatform',
        component: () => import('@/views/finance/Finance.vue'),
        props: { orderType: 1 },
        meta: { title: t('finance/platform'), requiresAuth: true }
      },
      {
        path: 'finance/distribution',
        name: 'FinanceDistribution',
        component: () => import('@/views/finance/Finance.vue'),
        props: { orderType: 2 },
        meta: { title: t('finance/distribution'), requiresAuth: true }
      },
      {
        path: 'finance/retail',
        name: 'FinanceRetail',
        component: () => import('@/views/finance/Finance.vue'),
        props: { orderType: 3 },
        meta: { title: t('finance/retail'), requiresAuth: true }
      },
      {
        path: 'finance/bulk-machine',
        name: 'FinanceBulkMachine',
        component: () => import('@/views/finance/Finance.vue'),
        props: { orderType: 4 },
        meta: { title: t('finance/bulk-machine'), requiresAuth: true }
      },
      {
        path: 'finance/retail-machine',
        name: 'FinanceRetailMachine',
        component: () => import('@/views/finance/Finance.vue'),
        props: { orderType: 6 },
        meta: { title: t('finance/retail-machine'), requiresAuth: true }
      },
      {
        path: 'water-tickets',
        name: 'WaterTicketManage',
        component: () => import('@/views/waterTicket/WaterTicketManage.vue'),
        meta: { title: t('water-tickets'), requiresAuth: true }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由守卫
router.beforeEach((to, from, next) => {
  const auth = useAuthStore()
  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    next('/login')
  } else if (to.path === '/login' && auth.isLoggedIn) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
