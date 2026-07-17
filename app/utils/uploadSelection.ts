/**
 * 上传弹窗中一个待上传条目（选择集的行模型）。
 *
 * 这里**只**放选择本身派生的数据。查重结果（duplicate）刻意不进来：
 * 查重是分批渐进返回的（2000 张 = 11 批），若挂在条目上，每批落地都要
 * 重建整个数组（2000 次 uploadSelectionId + 2000 次对象分配）并让数组
 * 换 identity，进而让虚拟列表的可视区 watch 重跑——实测 300~560ms 长任务。
 * 重复名以 Set 单独下发，只影响可视区那几行的渲染。
 */
export interface UploadSelectionItem {
  /** 稳定行标识，见 uploadSelectionId */
  id: string
  file: File
}

/**
 * 待上传文件的稳定标识：name + size + lastModified。
 *
 * 虚拟列表的行 key 必须稳定（不能用 index）——剔除重复项会移除中间行，
 * index 做 key 会让行组件错位复用，缩略图画到别的文件上。
 * 同名同大小同修改时间视为同一文件，顺带去掉重复选择。
 */
export const uploadSelectionId = (file: File): string =>
  `${file.name}::${file.size}::${file.lastModified}`
