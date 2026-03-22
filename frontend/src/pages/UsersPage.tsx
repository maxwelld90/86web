import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Shield, User as UserIcon, CheckCircle, XCircle } from 'lucide-react'
import { userApi, formatBytes } from '../lib/api'
import { useStore } from '../store/useStore'
import { User } from '../types'
import { clsx } from 'clsx'
import ConfirmDialog from '../components/ConfirmDialog'

function UserModal({ initial, onSave, onClose }: {
  initial?: User
  onSave: (data: Partial<User> & { password?: string }) => Promise<void>
  onClose: () => void
}) {
  const isLdap = !!initial?.is_ldap
  const isBootstrap = !!initial?.is_bootstrap
  const [form, setForm] = useState({
    username: initial?.username || '',
    email: initial?.email || '',
    password: '',
    is_admin: initial?.is_admin || false,
    is_active: initial?.is_active !== false,
    max_vms: initial?.max_vms ?? 10,
    max_storage_gb: initial?.max_storage_gb ?? 100,
    can_manage_vms: initial?.can_manage_vms ?? true,
    can_manage_groups: initial?.can_manage_groups ?? true,
    can_access_library: initial?.can_access_library ?? true,
    can_upload_images: initial?.can_upload_images ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const data: any = { ...form }
      if (!data.password || isLdap) delete data.password
      if (initial) delete data.username // can't change username
      if (isLdap) delete data.email    // LDAP manages email
      await onSave(data)
      onClose()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md card p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-5">
          {initial ? `Edit User — ${initial.username}` : 'Create User'}
        </h2>
        {isLdap && (
          <p className="text-xs text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 rounded px-3 py-2 mb-4">
            LDAP account — email and password are managed by the directory server.
          </p>
        )}
        <div className="space-y-4">
          {!initial && (
            <div>
              <label className="label mb-1.5 block">Username</label>
              <input className="input" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} placeholder="jsmith" />
            </div>
          )}
          {!isLdap && (
            <>
              <div>
                <label className="label mb-1.5 block">Email</label>
                <input type="email" className="input" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="user@example.com" />
              </div>
              <div>
                <label className="label mb-1.5 block">{initial ? 'New Password (leave blank to keep)' : 'Password'}</label>
                <input type="password" className="input" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={initial ? '••••••••' : 'Min. 8 characters'} autoComplete="new-password" />
              </div>
            </>
          )}
          {isLdap && initial && (
            <div>
              <label className="label mb-1.5 block">Email</label>
              <input type="email" className="input opacity-60 cursor-not-allowed" value={form.email} readOnly />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label mb-1.5 block">Max VMs</label>
              <input type="number" min={0} max={9999} className="input" value={form.max_vms} onChange={e => setForm(f => ({ ...f, max_vms: parseInt(e.target.value) }))} />
            </div>
            <div>
              <label className="label mb-1.5 block">Max Storage (GB)</label>
              <input type="number" min={0} max={999999} className="input" value={form.max_storage_gb} onChange={e => setForm(f => ({ ...f, max_storage_gb: parseInt(e.target.value) }))} />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className={`flex items-center gap-2 ${isBootstrap ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`} title={isBootstrap ? 'Built-in admin account cannot lose admin status' : undefined}>
              <input type="checkbox" checked={form.is_admin} disabled={isBootstrap} onChange={e => setForm(f => ({ ...f, is_admin: e.target.checked }))} className="rounded accent-blue-600" />
              <span className="text-sm text-slate-700 dark:text-slate-300">Admin</span>
            </label>
            <label className={`flex items-center gap-2 ${isBootstrap ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`} title={isBootstrap ? 'Built-in admin account cannot be deactivated' : undefined}>
              <input type="checkbox" checked={form.is_active} disabled={isBootstrap} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded accent-blue-600" />
              <span className="text-sm text-slate-700 dark:text-slate-300">Active</span>
            </label>
          </div>
        </div>
          <div className="border-t border-slate-200 dark:border-slate-800 pt-4 mt-4">
            <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">Permissions</h3>
            <div className="space-y-3">
              {[
                { key: 'can_manage_vms', label: 'Create & Delete VMs', desc: 'Allow user to create, edit and delete Virtual Machines.' },
                { key: 'can_manage_groups', label: 'Manage Groups', desc: 'Allow user to create and edit VM folders/groups.' },
                { key: 'can_access_library', label: 'Access Global Library', desc: 'Allow user to see the read-only ISO library.' },
                { key: 'can_upload_images', label: 'Upload Images', desc: 'Allow user to upload custom ISOs and floppy images.' },
              ].map(perm => (
                <div key={perm.key} className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-medium text-slate-700 dark:text-slate-300 ${form.is_admin ? 'opacity-50' : ''}`}>{perm.label}</p>
                    <p className={`text-xs text-slate-500 mt-0.5 ${form.is_admin ? 'opacity-50' : ''}`}>{perm.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, [perm.key]: !(f as any)[perm.key] }))}
                    disabled={form.is_admin}
                    className={clsx(
                      'flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                      form.is_admin ? 'bg-blue-300 dark:bg-blue-900/50 cursor-not-allowed' : (form as any)[perm.key] ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600',
                    )}
                    title={form.is_admin ? 'Admins always have all permissions' : undefined}
                  >
                    <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', (form.is_admin || (form as any)[perm.key]) ? 'translate-x-6' : 'translate-x-1')} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
        <div className="flex gap-3 mt-6 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function UsersPage() {
  const qc = useQueryClient()
  const { currentUser } = useStore()
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser] = useState<User | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<User | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: userApi.list,
  })

  const createMut = useMutation({
    mutationFn: (data: any) => userApi.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: any) => userApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => userApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">User Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{users.length} {users.length === 1 ? 'user' : 'users'}</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Create User
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              {['User', 'Role', 'Status', 'VMs', 'Storage', 'Last Login', 'Actions'].map(h => (
                <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${user.is_ldap ? 'bg-violet-100 dark:bg-violet-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                      <span className={`text-xs font-semibold ${user.is_ldap ? 'text-violet-700 dark:text-violet-400' : 'text-blue-700 dark:text-blue-400'}`}>
                        {user.username[0].toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-slate-900 dark:text-white">{user.username}</p>
                        {user.is_ldap && (
                          <span className="text-xs font-medium text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 px-1.5 py-0.5 rounded">
                            LDAP
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400">{user.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  {user.is_admin ? (
                    <span className="flex items-center gap-1.5 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full w-fit">
                      <Shield className="w-3 h-3" />Admin
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full w-fit">
                      <UserIcon className="w-3 h-3" />User
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {user.is_active ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <CheckCircle className="w-3.5 h-3.5" />Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-slate-400">
                      <XCircle className="w-3.5 h-3.5" />Disabled
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-slate-600 dark:text-slate-400 text-xs tabular-nums">
                  {user.vm_count} / {user.max_vms >= 9999 ? '∞' : user.max_vms}
                </td>
                <td className="px-5 py-3 text-slate-600 dark:text-slate-400 text-xs tabular-nums">
                  {formatBytes(user.disk_usage_bytes)} / {user.max_storage_gb >= 999999 ? '∞' : `${user.max_storage_gb} GB`}
                </td>
                <td className="px-5 py-3 text-xs text-slate-400">
                  {user.last_login ? new Date(user.last_login).toLocaleDateString() : '—'}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setEditUser(user)} className="btn-ghost p-1.5">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {user.id !== currentUser?.id && !user.is_bootstrap && (
                      <button
                        onClick={() => setDeleteConfirm(user)}
                        className="btn-ghost p-1.5 text-red-400 hover:text-red-600"
                        title={user.is_admin ? 'Delete admin user' : 'Delete user'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && !isLoading && (
          <div className="px-5 py-12 text-center text-sm text-slate-400">No users found</div>
        )}
      </div>

      {showCreate && (
        <UserModal
          onClose={() => setShowCreate(false)}
          onSave={async (data) => { await createMut.mutateAsync(data as any) }}
        />
      )}

      {editUser && (
        <UserModal
          initial={editUser}
          onClose={() => setEditUser(null)}
          onSave={async (data) => { await updateMut.mutateAsync({ id: editUser.id, ...data }) }}
        />
      )}

      {deleteConfirm && (
        <ConfirmDialog
          title="Delete User?"
          message={`Permanently delete "${deleteConfirm.username}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => { deleteMut.mutate(deleteConfirm.id); setDeleteConfirm(null) }}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  )
}
