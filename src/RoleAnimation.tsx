import React, { useEffect, useRef, useState } from 'react';
import { Role } from './types';
import { ROLE_ART, ROLE_VIDEO } from './artAssets';
import { ROLE_LABELS } from './constants';

export function RoleAnimation({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  if (!ROLE_VIDEO[role]) return null;
  return <>
    <button ref={trigger} className="role-animation-trigger" onClick={() => { setFailed(false); setOpen(true); }}>▶ 身份动画</button>
    {open && <dialog ref={dialog} className="role-animation-dialog" aria-label={`${ROLE_LABELS[role]}身份动画`} onCancel={close} onClose={close}>
      <header><strong>{ROLE_LABELS[role]} · 你的身份动画</strong><button autoFocus onClick={close}>关闭 ×</button></header>
      <video key={role} src={ROLE_VIDEO[role]} poster={ROLE_ART[role]} autoPlay muted playsInline controls preload="auto" onError={() => setFailed(true)} />
      {failed && <p role="alert">视频暂时无法加载，请关闭后重试。</p>}
      <p>可通过播放控件重播或开启声音。此窗口不会重新抽牌。</p>
    </dialog>}
  </>;
}
