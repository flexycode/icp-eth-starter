import { Actor, HttpAgent } from '@dfinity/agent';
import {
  AuthClient,
  AuthClientLoginOptions,
  ERROR_USER_INTERRUPT,
} from '@dfinity/auth-client';
import useObservableState from '../hooks/utils/useObservableState';
import { applicationName } from '../setupApp';
import { handleError } from '../utils/handlers';
import makeObservable from '../utils/makeObservable';
import { unwrap } from '../utils/unwrap';
import { getBackend, isLocalNetwork } from './backendService';

export type User = {
  type: 'ic';
  client: AuthClient;
  detail: UserDetail;
};

export interface UserDetail {
  jobIds: string[];
  instanceIds: string[];
  unlockedCycles: string;
  lockedCycles: string;
  wallet: string | undefined;
}

export const USER_STORE = makeObservable<User | null | undefined>();

const localIdentityProvider = `http://localhost:4943?canisterId=${process.env.INTERNET_IDENTITY_CANISTER_ID}`;

const clientPromise = window.indexedDB
  ? AuthClient.create()
  : Promise.resolve(undefined);

const loginIC = async (
  options?: Omit<Omit<AuthClientLoginOptions, 'onSuccess'>, 'onError'>,
) => {
  const client = await clientPromise;
  if (client) {
    try {
      await new Promise((onSuccess: any, onError) =>
        client.login({
          maxTimeToLive: BigInt(7 * 24 * 60 * 60 * 1e9),
          ...(options || {}),
          onSuccess,
          onError,
        }),
      );
    } catch (err) {
      if (err === ERROR_USER_INTERRUPT) {
        return;
      }
      throw err;
    }
    await finishLoginIC(client);
  }
  return client;
};

const finishLoginIC = async (client: AuthClient) => {
  const agent = Actor.agentOf(getBackend()) as HttpAgent;
  agent.replaceIdentity(client.getIdentity());

  const detail = await loadUserDetail();
  console.log('User:', detail);
  USER_STORE.set({
    type: 'ic',
    client,
    detail,
  });
};

const loadUserDetail = async (): Promise<UserDetail> => {
  try {
    // TODO: return optional value from canister
    const account = await getBackend().get_account();
    return {
      jobIds: [...account.job_ids].map((n) => String(n)),
      instanceIds: [...account.instance_ids].map((n) => String(n)),
      unlockedCycles: String(account.unlocked_cycles),
      lockedCycles: String(account.locked_cycles),
      wallet: unwrap(account.wallet, String),
    };
  } catch (err) {
    console.warn(err);
    return {
      jobIds: [],
      instanceIds: [],
      unlockedCycles: '0',
      lockedCycles: '0',
      wallet: undefined,
    };
  }
};

if (window.indexedDB) {
  (async () => {
    try {
      const client = await clientPromise;
      if (client && (await client.isAuthenticated())) {
        await finishLoginIC(client);
      } else {
        USER_STORE.set(null);
      }
    } catch (err) {
      handleError(err, 'Error while fetching user info!');
      window.indexedDB.deleteDatabase('auth-client-db'); // Clear login cache
      USER_STORE.set(null);
      return;
    }
  })();
} else {
  USER_STORE.set(null);
}

export async function loginInternetIdentity() {
  return loginIC({
    identityProvider: isLocalNetwork() ? localIdentityProvider : undefined,
  });
}

export async function loginNFID() {
  return loginIC({
    identityProvider: `https://nfid.one/authenticate/?applicationName=${encodeURIComponent(
      applicationName,
    )}`,
  });
}

export async function logout() {
  const user = USER_STORE.get();
  if (user?.type === 'ic') {
    await user.client.logout();
  }
  USER_STORE.set(null);
}

export async function refreshUser() {
  const user = USER_STORE.get();
  if (!user) {
    return;
  }
  USER_STORE.set({
    ...user,
    detail: await loadUserDetail(),
  });
}

export default function useIdentity(): User | null | undefined {
  return useObservableState(USER_STORE)[0];
}
