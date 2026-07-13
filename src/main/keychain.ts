import keytar from 'keytar'

const SERVICE_NAME = 'com.elrond.app'

export async function getApiKey(provider: string): Promise<string | null> {
  return keytar.getPassword(SERVICE_NAME, provider)
}

export async function setApiKey(provider: string, key: string): Promise<void> {
  await keytar.setPassword(SERVICE_NAME, provider, key)
}

export async function deleteApiKey(provider: string): Promise<void> {
  await keytar.deletePassword(SERVICE_NAME, provider)
}

// All account names stored under the app's Keychain service — lets callers
// sweep prefixed entries (e.g. every `mcp:<serverId>:*` secret on delete)
export async function findCredentialAccounts(): Promise<string[]> {
  const creds = await keytar.findCredentials(SERVICE_NAME)
  return creds.map((c) => c.account)
}
