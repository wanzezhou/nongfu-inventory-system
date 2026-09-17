<template>
  <!--
    三级菜单：财务管理下「营收统计 / 成本统计 / 利润统计」的页面级入口，置于内容区顶部。
    标签项完全来自 menuConfig.tabGroups（成本组现含 9 项：成本汇总 + 6 类成本 + 其他支出 + 工资统计），
    数量超出宽度时由 el-tabs 自带的横向滚动箭头承载，无需额外处理。
  -->
  <div v-if="group" class="nav-tabs-bar">    <el-tabs
      class="nav-tabs"
      :model-value="route.path"
      @tab-change="handleChange"
    >
      <el-tab-pane
        v-for="tab in group.tabs"
        :key="tab.index"
        :label="tab.title"
        :name="tab.index"
      />
    </el-tabs>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { tabGroupOf } from './menuConfig'

const route = useRoute()
const router = useRouter()

// 当前路径命中的三级标签组；命中不了（如仪表盘、库存等非财务页面）则整条标签栏不渲染
const group = computed(() => tabGroupOf(route.path))

const handleChange = (index) => {
  if (index && index !== route.path) router.push(index)
}
</script>

<style scoped>
.nav-tabs-bar {
  background: var(--card);
  border-bottom: 1px solid var(--border);
  /* 左右内边距与 .main-content 对齐，标签起始位置与页面内容齐平 */
  padding: 0 20px;
}

.nav-tabs :deep(.el-tabs__header) {
  margin: 0;
}

/* 去掉 el-tabs 默认的整条下划线（由本容器 border-bottom 承担） */
.nav-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.nav-tabs :deep(.el-tabs__item) {
  height: 40px;
  line-height: 40px;
  font-size: 13px;
  padding: 0 14px;
}

.nav-tabs :deep(.el-tabs__item.is-active) {
  font-weight: 600;
}

@media (max-width: 768px) {
  .nav-tabs-bar {
    padding: 0 10px;
  }

  .nav-tabs :deep(.el-tabs__item) {
    height: 38px;
    line-height: 38px;
    padding: 0 10px;
    font-size: 12px;
  }
}
</style>
