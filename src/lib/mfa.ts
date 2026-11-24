import { supabase } from './supabase'

export const MFA_NAME = 'SportCliq Admin'

export async function assurance() {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw error
  return data
}

export async function verifiedTotp() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw error
  return data.totp.find((f) => f.status === 'verified') ?? null
}

/** Starts authenticator setup. Clears any half finished setup first. */
export async function startEnrollment() {
  const { data: list } = await supabase.auth.mfa.listFactors()
  for (const f of list?.all ?? []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: MFA_NAME, issuer: MFA_NAME })
  if (error) throw error
  return data
}

export async function verifyCode(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (error) throw error
}

/** Re-checks the authenticator so the database accepts a payout or delete in the next 5 minutes. */
export async function stepUp(code: string) {
  const factor = await verifiedTotp()
  if (!factor) throw new Error('Set up your authenticator app first')
  await verifyCode(factor.id, code)
}
