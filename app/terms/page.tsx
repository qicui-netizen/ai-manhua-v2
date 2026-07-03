import LegalPage from "@/components/LegalPage";
import { TERMS_DOC } from "@/lib/legal";

export const metadata = { title: "用户协议 · PanelForge" };

export default function TermsPage() {
  return <LegalPage doc={TERMS_DOC} />;
}
