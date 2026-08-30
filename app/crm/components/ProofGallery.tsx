import { formatDate } from "@/lib/domain/format";
import type { MailingProof } from "@/lib/client/mailing-proofs";

export default function ProofGallery({ proofs, title = "Proof of Mailing" }: { proofs: MailingProof[]; title?: string }) {
  return (
    <section className="mailing-proof-gallery" aria-label={title}>
      <div className="panel-head"><div><h3>{title}</h3><p>Photos taken before completed mailings were placed in the finished bin.</p></div><span className="panel-count">{proofs.length}</span></div>
      {proofs.length ? <div className="proof-photo-grid">{proofs.map((proof) => <a href={proof.imageUrl} target="_blank" rel="noreferrer" className="proof-photo" key={proof.id}><img src={proof.imageUrl} alt={`${proof.recipientName}, ${proof.character} letter ${proof.letterNumber ?? ""}`} /><strong>{proof.recipientName}</strong><span>{proof.character} · Letter {proof.letterNumber ?? "—"} · {formatDate(proof.shipDate)}</span></a>)}</div> : <p className="empty-state">No mailing photos yet.</p>}
    </section>
  );
}
