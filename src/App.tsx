import { useCallback, useEffect, useMemo, useState } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { createBackend, loadConnection, saveConnection, type Connection } from './backend'
import { StoreProvider, ToastProvider } from './lib/store'
import { canManage, isStaff, type Profile } from './lib/types'
import Audit from './pages/Audit'
import History from './pages/History'
import Home from './pages/Home'
import Login, { Waiting } from './pages/Login'
import ProductCard from './pages/ProductCard'
import Products from './pages/Products'
import Receipt from './pages/Receipt'
import Reports from './pages/Reports'
import Returns, { CancelSale, ReturnForm, WriteOffForm } from './pages/Returns'
import Sale from './pages/Sale'
import Settings from './pages/Settings'
import Setup from './pages/Setup'

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  )
}

function Root() {
  const [conn, setConn] = useState<Connection | null>(() => loadConnection())
  const backend = useMemo(() => (conn ? createBackend(conn) : null), [conn])
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)

  const refreshProfile = useCallback(async () => {
    if (!backend) return
    try {
      setProfile(await backend.currentProfile())
    } catch {
      setProfile(null)
    }
  }, [backend])

  useEffect(() => {
    setProfile(undefined)
    refreshProfile()
    return backend?.onAuthChange(refreshProfile)
  }, [backend, refreshProfile])

  const changeConnection = (c: Connection | null) => {
    saveConnection(c)
    setConn(c)
  }

  if (!conn || !backend) return <Setup onDone={changeConnection} />
  if (profile === undefined) return <div className="splash"><div className="spinner" />Загрузка…</div>
  if (!profile) return <Login backend={backend} onDone={refreshProfile} onChangeConnection={() => changeConnection(null)} />
  if (!isStaff(profile.role)) {
    return <Waiting profile={profile} onRefresh={refreshProfile} onSignOut={async () => { await backend.signOut(); refreshProfile() }} />
  }

  const signOut = async () => {
    await backend.signOut()
    if (backend.mode === 'local') changeConnection(null)
    else refreshProfile()
  }

  const manager = canManage(profile.role)

  return (
    <StoreProvider key={profile.id + profile.role} backend={backend} profile={profile} onSignOut={signOut}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/sale" element={<Sale />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductCard />} />
          <Route path="/receipt" element={manager ? <Receipt /> : <Navigate to="/" />} />
          <Route path="/audit" element={manager ? <Audit /> : <Navigate to="/" />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/returns" element={<Returns />} />
          <Route path="/returns/writeoff" element={manager ? <WriteOffForm /> : <Navigate to="/returns" />} />
          <Route path="/returns/return" element={<ReturnForm />} />
          <Route path="/returns/cancel" element={manager ? <CancelSale /> : <Navigate to="/returns" />} />
          <Route path="/history" element={<History />} />
          <Route path="/settings" element={<Settings onChangeConnection={changeConnection} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </HashRouter>
    </StoreProvider>
  )
}
