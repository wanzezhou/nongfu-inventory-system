import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '@/layout/MainLayout.vue'

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
        meta: { title: '仪表盘', icon: 'HomeFilled', requiresAuth: true }
      },
      {
        path: 'product',
        name: 'Product',
        component: () => import('@/views/product/ProductList.vue'),
        meta: { title: '商品管理', icon: 'Goods', requiresAuth: true }
      },
      {
        path: 'inventory',
        name: 'Inventory',
        component: () => import('@/views/inventory/InventoryList.vue'),
        meta: { title: '库存管理', icon: 'Box', requiresAuth: true }
      },
      {
        path: 'order',
        name: 'Order',
        component: () => import('@/views/order/OrderList.vue'),
        meta: { title: '订单管理', icon: 'Document', requiresAuth: true }
      },
      {
        path: 'station',
        name: 'Station',
        component: () => import('@/views/station/StationList.vue'),
        meta: { title: '水站管理', icon: 'Shop', requiresAuth: true }
      },
      {
        path: 'bulk-machine',
        name: 'BulkMachine',
        component: () => import('@/views/machine/MachineStationList.vue'),
        props: () => ({ machineType: 1, moduleTitle: '量贩机' }),
        meta: { title: '量贩机管理', icon: 'Shop', requiresAuth: true }
      },
      {
        path: 'retail-machine',
        name: 'RetailMachine',
        component: () => import('@/views/machine/MachineStationList.vue'),
        props: () => ({ machineType: 2, moduleTitle: '零售机' }),
        meta: { title: '零售机管理', icon: 'Shop', requiresAuth: true }
      },
      {
        path: 'supplier',
        name: 'Supplier',
        component: () => import('@/views/supplier/SupplierList.vue'),
        meta: { title: '供应商管理', icon: 'OfficeBuilding', requiresAuth: true }
      },
      {
        path: 'worker',
        name: 'Worker',
        component: () => import('@/views/worker/WorkerList.vue'),
        meta: { title: '员工管理', icon: 'User', requiresAuth: true }
      },
      {
        path: 'salesman',
        name: 'Salesman',
        component: () => import('@/views/salesman/SalesmanList.vue'),
        meta: { title: '业务员管理', icon: 'Avatar', requiresAuth: true }
      },
      {
        path: 'statistics/product-sales',
        name: 'ProductSales',
        component: () => import('@/views/statistics/ProductSales.vue'),
        meta: { title: '商品销售统计', icon: 'TrendCharts', requiresAuth: true }
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
  const token = localStorage.getItem('token')
  if (to.meta.requiresAuth && !token) {
    next('/login')
  } else if (to.path === '/login' && token) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
