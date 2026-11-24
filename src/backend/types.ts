import type {
  BackupData, Bank, Category, Operation, OperationInput, OperationQuery, Product, ProductDraft, ProductMovement, Profile, Role,
} from '../lib/types'

export interface Backend {
  mode: 'local' | 'cloud'

  // --- авторизация ---
  currentProfile(): Promise<Profile | null>
  signIn(email: string, password: string): Promise<void>
  signUp(email: string, password: string, name: string): Promise<void>
  signOut(): Promise<void>
  onAuthChange(cb: () => void): () => void

  // --- справочники ---
  listProducts(): Promise<Product[]>
  saveProduct(p: ProductDraft): Promise<Product>
  setProductArchived(id: string, archived: boolean): Promise<void>
  listCategories(): Promise<Category[]>
  saveCategory(c: { id?: string; name: string }): Promise<Category>
  deleteCategory(id: string): Promise<void>
  listBanks(): Promise<Bank[]>
  saveBank(b: { id?: string; name: string }): Promise<Bank>
  deleteBank(id: string): Promise<void>
  getSettings(): Promise<Record<string, unknown>>
  setSetting(key: string, value: unknown): Promise<void>

  /** Подписка на изменения товаров с других устройств */
  subscribeProducts(cb: (p: Product) => void): () => void

  // --- операции ---
  postOperation(input: OperationInput): Promise<Operation>
  cancelSale(id: string, reason: string): Promise<Operation>
  listOperations(q: OperationQuery): Promise<Operation[]>
  getOperation(id: string): Promise<Operation | null>
  /** Операции, ссылающиеся на данную (возвраты и отмены продажи) */
  listLinkedOperations(id: string): Promise<Operation[]>
  productHistory(productId: string): Promise<ProductMovement[]>

  // --- сотрудники ---
  listStaff(): Promise<Profile[]>
  setStaffRole(id: string, role: Role): Promise<void>
  setStaffName(id: string, name: string): Promise<void>

  // --- резервные копии ---
  exportBackup(): Promise<BackupData>
  importBackup?(data: BackupData): Promise<void>
}
