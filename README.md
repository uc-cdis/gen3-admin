# Gen3 Admin

This is a first attempt at creating an admin dashboard, very much WIP. 

The idea is to move a lot of the functionality of what operators do in an adminvm to an api + UI. 

This is being developed by the PE team. 


# Frontend 

Frontend is written in next.js using mantine as the library. 

It's using pages router to route. 

If you wanna add a new page add it under the `pages` folder. 

# Backend 

Go api using gin.

Calls k8s api based on your current context.


# Dev environment

Make sure you have a kubectl set up and working towards a k8s cluster. KIND is a great way to run kubernetes in docker f.ex

Then run these commands:

## start api
```
cd gen3-admin-api/
export PORT=8002; nodemon --exec go run main.go --signal SIGTERM
```

## start frontend

In a separate terminal 
```
cd gen3-admin-frontend/

npm install
npm run dev
```