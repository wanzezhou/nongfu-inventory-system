import { reactive } from 'vue'

/**
 * 列表分页骨架（D6：消除 8+ 列表页复制的 pagination/handleSizeChange/handleCurrentChange）
 *
 * 用法（script setup 内，fetchData 为本页取数函数，可后置定义——调用包一层箭头函数避免 TDZ）：
 *   const { pagination, handleSizeChange, handleCurrentChange } = usePagination(() => fetchData())
 *   // fetchData 成功后照常 pagination.total = res.data.total
 *
 * 模板绑定不变：
 *   v-model:current-page="pagination.page" v-model:page-size="pagination.pageSize"
 *   @size-change="handleSizeChange" @current-change="handleCurrentChange"
 */
export function usePagination(fetchFn, { pageSize = 10 } = {}) {
  const pagination = reactive({
    page: 1,
    pageSize,
    total: 0
  })

  // 改变页大小后回到第一页
  const handleSizeChange = (size) => {
    pagination.pageSize = size
    pagination.page = 1
    fetchFn()
  }

  const handleCurrentChange = (page) => {
    pagination.page = page
    fetchFn()
  }

  return { pagination, handleSizeChange, handleCurrentChange }
}
