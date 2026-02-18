// pages/index.js
import Head from 'next/head'
import Image from 'next/image'

export default function Home() {
  return (
    <>
      <Head>
        <title>Goldnation (GLDN) – Digital Gold Infrastructure</title>
        <meta name="description" content="Goldnation (GLDN) – Digital Gold Infrastructure on Solana. Fixed supply, structured tokenomics, and institutional positioning. Launching March 15." />
        
        {/* Open Graph / Social */}
        <meta property="og:title" content="Goldnation (GLDN) – Digital Gold Infrastructure" />
        <meta property="og:description" content="Digital Gold Infrastructure on Solana. Fixed supply, structured tokenomics, and institutional positioning. Launching March 15." />
        <meta property="og:image" content="/logo.png" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://yourdomain.com" />

        {/* Favicon */}
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <header style={headerStyle}>
        <Image src="/logo.png" alt="Goldnation Logo" width={80} height={80} />
        <h1 style={{ marginLeft: '15px' }}>Goldnation (GLDN)</h1>
      </header>

      <main style={mainStyle}>
        <section style={sectionStyle}>
          <h2>Digital Gold on Solana</h2>
          <p>
            Goldnation offers a fixed supply token with structured tokenomics, designed for institutional-grade investment.
            Launching March 15. Join our Telegram and follow us on X for updates!
          </p>
          <div style={{ marginTop: '20px' }}>
            <a href="https://t.me/golnation" target="_blank" rel="noopener noreferrer" style={buttonStyle}>Join Telegram</a>
            <a href="https://x.com/GoldNationWorld" target="_blank" rel="noopener noreferrer" style={{ ...buttonStyle, marginLeft: '10px' }}>Follow on X</a>
          </div>
        </section>
      </main>

      <footer style={footerStyle}>
        <p>© 2026 Goldnation. All rights reserved.</p>
      </footer>
    </>
  )
}

// Simple inline styles (ou ka ranplase ak Tailwind oswa CSS modèn si ou vle)
const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  padding: '20px',
  backgroundColor: '#FFD700',
  color: '#000'
}

const mainStyle = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '70vh',
  backgroundColor: '#f5f5f5',
  padding: '20px'
}

const sectionStyle = {
  maxWidth: '800px',
  textAlign: 'center'
}

const buttonStyle = {
  padding: '10px 20px',
  backgroundColor: '#FFD700',
  color: '#000',
  textDecoration: 'none',
  fontWeight: 'bold',
  borderRadius: '8px'
}

const footerStyle = {
  textAlign: 'center',
  padding: '15px',
  backgroundColor: '#222',
  color: '#fff'
}
