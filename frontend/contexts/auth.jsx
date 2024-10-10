import React, { createContext, useState, useContext, useEffect } from 'react'
import { getCookie, deleteCookie, setCookie } from 'cookies-next';


const AuthContext = createContext({
    user: null,
    login: () => { },
    logout: () => { },
    authorized: false,
    url: null,
    token: null,
})


function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error('Error parsing JWT:', error);
        return null;
    }
}


let jwtParsed;



export const AuthProvider = ({ children }) => {

    const [user, setUser] = useState(jwtParsed)
    const [url, setUrl] = useState(null)
    const [accessToken, setAccessToken] = useState(null)
    const [loading, setLoading] = useState(true)
    const [authorized, setAuthorized ] = useState(false)

    useEffect(() => {
        function loadUserFromCookies() {
            const token = getCookie('access_token')
            setAccessToken(token)
            if (token) {
                console.log("Got a token in the cookies, let's see if it is valid")
                jwtParsed = parseJwt(token)
                setUser(jwtParsed)
                setUrl(new URL(jwtParsed?.iss))
                setLoading(false)
            }
            setLoading(false)
        }
        loadUserFromCookies()
    }, [])

    const login = async (apiKeyData) => {
        // Simulated error for dev
        // throw new Error("Fake error");

        try {
            if (!apiKeyData || !apiKeyData.api_key) {
                throw new Error('Invalid API key data');
            }

            const parsedToken = parseJwt(apiKeyData.api_key);
            if (!parsedToken || !parsedToken.iss) {
                throw new Error('Unable to extract URL from API key');
            }

            const baseUrl = parsedToken.iss;
            const fenceApiUrl = `${baseUrl}/credentials/api/access_token`;

            const response = await fetch(fenceApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    api_key: apiKeyData.api_key,
                    key_id: apiKeyData.key_id,
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const json = await response.json();
            const { access_token } = json;

            // Validate the token
            const payload = parseJwt(access_token);

            if (!payload) {
                throw new Error('Invalid access token');
            }

            setCookie('access_token', access_token);
            console.log(payload)
            setUser(payload)
            setUrl(new URL(payload?.iss))
            // TODO: Talk to arborist or rely on a call to backend api? 
            setAuthorized(true)
            return payload; // Return the decoded payload for further use if needed
        } catch (error) {
            console.error('Login error:', error);
            deleteCookie('access_token');
            throw error; // Re-throw the error for the caller to handle
        }
    };

    const logout = () => {
        console.log("Logging out user")
        deleteCookie('access_token')
        setUser(null)
    }


    return (
        <AuthContext.Provider value={{ isAuthenticated: !!user, user, login, logout, loading, authorized, url, token: accessToken }}>
            {children}
        </AuthContext.Provider>
    )
}


export default AuthContext