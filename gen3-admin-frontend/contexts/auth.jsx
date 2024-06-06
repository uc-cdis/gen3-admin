import React, { createContext, useState, useContext, useEffect } from 'react'
import { getCookie, deleteCookie, setCookie } from 'cookies-next';
// import Router, { useRouter } from 'next/router'
import { decodeJwt, JWTPayload } from 'jose';


const GEN3_FENCE_API = process.env.GEN3_FENCE_API || "https://changeme.planx-pla.net"
const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {

    const [user, setUser] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function loadUserFromCookies() {
            const token = getCookie('access_token')
            if (token) {
                console.log("Got a token in the cookies, let's see if it is valid")
                // api.defaults.headers.Authorization = `Bearer ${token}`
                // const { data: user } = await api.get('users/me')
                // if (user) setUser(user);
                setUser("Jane Smith")
                setLoading(false)
            }
            setLoading(false)
        }
        loadUserFromCookies()
    }, [])

    const login = async (api_key, key_id) => {

        const response = await fetch(`${GEN3_FENCE_API}/user/credentials/api/access_token`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: api_key,
                    key_id: key_id,
                }),
            });

        if (response.status !== 200) {
            deleteCookie('access_token');
            setUser(null)
        }

        const json = await response.json();
        const {
            access_token
        } = json;

        // TODO: validate the token
        const payload = decodeJwt(access_token)

        if (!payload) {
            deleteCookie('access_token')
        }
        setCookie('access_token', access_token);
    }

    const logout = () => {
        deleteCookie('acces_token')
        setUser(null)
    }


    return (
        <AuthContext.Provider value={{ isAuthenticated: !!user, user, login, loading, logout }}>
            {children}
        </AuthContext.Provider>
    )
}



export const useAuth = () => useContext(AuthContext)


export const ProtectRoute = ({ children }) => {
    const { isAuthenticated, isLoading } = useAuth();
    if (isLoading || (!isAuthenticated && window.location.pathname !== '/login')){
      return <> Loading </>; 
    }
    return children;
  };
  