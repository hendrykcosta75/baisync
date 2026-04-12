import { LandingNavbar } from '@/components/landing-navbar'
import { PricingSection } from '@/components/landing/pricing-section'
import { FaqSection } from '@/components/landing/faq-section'
import { LandingFooter } from '@/components/landing/landing-footer'

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-black text-white font-[family-name:var(--font-jetbrains-mono)]">
      <LandingNavbar />
      <div className="pt-16">
        <PricingSection />
        <FaqSection />
      </div>
      <LandingFooter />
    </div>
  )
}
