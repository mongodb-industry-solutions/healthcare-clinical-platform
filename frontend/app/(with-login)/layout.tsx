import { LoginModal } from "@/components/login/login-modal"

export default function WithLoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <>
      {children}
      <LoginModal />
    </>
  )
}
