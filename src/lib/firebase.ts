import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { getFirestore, onSnapshot, collection, query, where, doc, setDoc, deleteDoc } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { useStore, Project } from '../store/useStore';

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

// Helper to sync Firebase to Zustand and vice versa
export function initFirebaseSync() {
  auth.onAuthStateChanged((user) => {
    useStore.setState({ user: user ? { uid: user.uid, email: user.email, name: user.displayName || '', photoUrl: user.photoURL || '' } : null });
    
    if (user) {
      const q = query(collection(db, 'projects'), where('userId', '==', user.uid));
      onSnapshot(q, (snapshot) => {
        const projects = snapshot.docs.map(doc => doc.data() as Project);
        useStore.setState((state) => ({
           // merge with local state to not overwrite volatile videoUrls if they match
           projects: projects.map(p => {
             const local = state.projects.find(localP => localP.id === p.id);
             return local ? { ...p, videoUrl: local.videoUrl } : p;
           })
        }));
      });
    } else {
      useStore.setState({ projects: [], activeProjectId: null });
    }
  });
}

// Wrapper for Store updates to DB
export async function syncProjectToDB(project: Project) {
    if (!auth.currentUser) return;
    const projectWithUser = { ...project, userId: auth.currentUser.uid };
    // Remove volatile values
    const dbProject = { ...projectWithUser };
    delete dbProject.videoUrl;
    delete dbProject.thumbnailUrl;
    await setDoc(doc(db, 'projects', project.id), dbProject, { merge: true });
}

export async function deleteProjectFromDB(id: string) {
    if (!auth.currentUser) return;
    await deleteDoc(doc(db, 'projects', id));
}
