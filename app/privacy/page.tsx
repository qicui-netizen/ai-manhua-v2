import LegalPage from "@/components/LegalPage";
import { PRIVACY_DOC } from "@/lib/legal";

export const metadata = { title: "隐私政策 · PanelForge" };

export default function PrivacyPage() {
  return <LegalPage doc={PRIVACY_DOC} />;
}
