"use client";
import { useEffect, useState } from "react";
import { IconArrow, IconSend, Stars } from "./Icons";

/**
 * A scripted, looping demo of one run inside a phone. Pure animation: no API calls, no chain.
 * The addresses and hashes are made up for the demo.
 */
const USER_TEXT = "send 0.01 eth to robinhood";
const STEPS = [
  { at: 400, step: 1 }, // typing in the composer
  { at: 2000, step: 2 }, // user bubble
  { at: 2500, step: 3 }, // agent typing
  { at: 3700, step: 4 }, // agent reply + plan card
  { at: 5600, step: 5 }, // confirm pressed
  { at: 6400, step: 6 }, // clean getaway
  { at: 10400, step: 0 }, // loop
];

export function DemoChat() {
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(6);
      return;
    }
    const timers = STEPS.map(({ at, step }) =>
      setTimeout(() => {
        setStep(step);
        if (step === 0) setCycle((c) => c + 1);
      }, at),
    );
    return () => timers.forEach(clearTimeout);
  }, [cycle]);

  useEffect(() => {
    if (step !== 1) {
      if (step === 0) setTyped(0);
      return;
    }
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= USER_TEXT.length) clearInterval(t);
    }, 48);
    return () => clearInterval(t);
  }, [step]);

  return (
    <div className="phone demo-phone" aria-hidden="true">
      <div className="phone-screen">
        <div className="phone-head">
          <div className="avatar-logo" aria-hidden="true">
            <img src="/logo.png" alt="" width={1378} height={1015} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="who">Grand Transfer Agent</div>
            <div className="status">
              <span className="dot" /> {step === 3 ? "planning…" : "online"}
            </div>
          </div>
        </div>
        <div className="messages demo-messages">
          {step >= 2 && <div className="bubble user pop-in">{USER_TEXT}</div>}
          {step === 3 && (
            <div className="bubble agent typing pop-in">
              <span />
              <span />
              <span />
            </div>
          )}
          {step >= 4 && (
            <>
              <div className="bubble agent pop-in">Got it. Here&apos;s the plan:</div>
              <div className={`plan-card pop-in${step >= 6 ? " closed" : ""}`}>
                <div className="title-row">
                  <p className="eyebrow">The plan</p>
                  {step >= 6 ? <span className="pill lime">Sent</span> : <Stars level={1} />}
                </div>
                <dl className="plan-rows">
                  <dt>To</dt>
                  <dd className="strong">robinhood</dd>
                  <dt>Address</dt>
                  <dd className="mono">0x8F3a…91C2</dd>
                  <dt>Amount</dt>
                  <dd className="strong">0.01 ETH</dd>
                  <dt>Est. gas</dt>
                  <dd>0.00002 ETH</dd>
                  <dt className="total">Total</dt>
                  <dd className="total strong">0.01002 ETH</dd>
                </dl>
                {step < 6 && (
                  <div className="plan-actions">
                    <span className={`btn lime small${step === 5 ? " pressed" : ""}`}>
                      Confirm <IconArrow className="arrow" />
                    </span>
                    <span className="btn ghost small">Abort</span>
                  </div>
                )}
              </div>
            </>
          )}
          {step >= 6 && (
            <div className="getaway-strip pop-in">
              <div className="display">Clean getaway</div>
              <div className="mono">0.01 ETH → robinhood · tx 0x4c1e…a7d8</div>
            </div>
          )}
        </div>
        <div className="composer">
          <div className="input demo-input">
            {step === 1 ? (
              <>
                {USER_TEXT.slice(0, typed)}
                <span className="caret" />
              </>
            ) : (
              <span className="faint">Tell the agent what to do…</span>
            )}
          </div>
          <span className="send-btn">
            <IconSend size={18} />
          </span>
        </div>
      </div>
    </div>
  );
}
