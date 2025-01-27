// pages/api/auth/[...nextauth].ts
import NextAuth from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"

import KeycloakProvider from "next-auth/providers/keycloak";


export default NextAuth({
  providers: [

    // Keycloak provider
    KeycloakProvider({
      clientId: "csoc",
      clientSecret: "EPDwJSCPCIPw1GO17txkqhYDOUFOIQYl",
      issuer: "http://:8080/realms/master",
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
        }
      },
    }),
    
    // Custom provider for mock authentication in development
    CredentialsProvider({
      id: "mock-provider",
      name: "Mock Provider",
      credentials: {
        username: { label: "Username", type: "text", placeholder: "John Doe" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        // You can return any mock user object here
        const user = {
          id: "1",
          name: "John Doe",
          email: "johndoe@example.com",
          image: "https://via.placeholder.com/150", // Fake profile image
        }

        // This is a mock authentication, so we ignore credentials and always return the mock user
        if (user) {
          return user
        } else {
          return null
        }
      }
    })
  ],
  
  callbacks: {
    async session({ session, token }) {
      // Attach the mock user details to the session
      session.user = {
        ...session.user,
        id: token.id,  // Static ID for the mock user
        // name: "John Doe",
        // email: "johndoe@example.com",
        // image: "https://via.placeholder.com/150",  // Provide a fake image
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }
      return session
    },
    async jwt({ token, user }) {
      // If user exists, set the token id to user id
      if (user) {
        token.id = user.id
      }
      return token
    }
  },

  // Enable debug mode for easier development
  debug: process.env.NODE_ENV === "development",
  secret: process.env.NEXTAUTH_SECRET, // Secret for signing JWT

  // Optional: Custom pages for authentication
  // pages: {
  //   signIn: '/auth/signin',  // You can customize the sign-in page if necessary
  // },
})
