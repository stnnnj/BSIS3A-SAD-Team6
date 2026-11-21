
/* ==========================================
CCMC RETAILFLOW – AUTHENTICATION
Step 8.4: Owner and Staff Role Selection
Step 8.5: Client-Side Validation
Step 8.6: Flask Login API Integration
========================================== */

document.addEventListener("DOMContentLoaded", function () {

    // ==========================================
    // HTML ELEMENTS
    // ==========================================

    const roleSelection = document.getElementById("roleSelection");
    const loginSection = document.getElementById("loginSection");

    const staffRoleBtn = document.getElementById("staffRoleBtn");
    const ownerRoleBtn = document.getElementById("ownerRoleBtn");
    const backToRoleBtn = document.getElementById("backToRoleBtn");

    const roleLabel = document.getElementById("roleLabel");
    const loginForm = document.getElementById("loginForm");
    const loginError = document.getElementById("loginError");

    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const signInBtn = document.getElementById("signInBtn");

    // Currently selected login role
    let selectedRole = null;

    // Prevent repeated login requests
    let isSubmitting = false;


    // ==========================================
    // CLEAR LOGIN FORM AND ERRORS
    // ==========================================

    function resetLogin() {

            loginForm.reset();

            loginError.textContent = "";
            loginError.classList.add("d-none");

            loginError.classList.remove(
                "alert-success"
            );

            loginError.classList.add(
                "alert-danger"
            );

            usernameInput.classList.remove("is-invalid");
            passwordInput.classList.remove("is-invalid");
        }


        // ==========================================
        // DISPLAY LOGIN MESSAGE
        // ==========================================

        function showMessage(message, type = "danger") {

                loginError.textContent = message;

                loginError.classList.remove(
                    "d-none",
                    "alert-danger",
                    "alert-success"
                );

                loginError.classList.add(
                    type === "success"
                    ? "alert-success"
                    : "alert-danger"
                );
            }


            /* ==========================================
            STEP 8.7 – ERROR HANDLING IMPROVEMENTS
            ========================================== */

            // Remove error styling when the user edits a field
            function clearFieldError(input) {

                    input.classList.remove("is-invalid");

                    loginError.textContent = "";
                    loginError.classList.add("d-none");

                }

                // Username input
                usernameInput.addEventListener("input", function () {
                    clearFieldError(usernameInput);
            });

            // Password input
            passwordInput.addEventListener("input", function () {
                clearFieldError(passwordInput);
        });

        // ==========================================
        // STEP 8.4 – ROLE SELECTION
        // ==========================================

        function showLogin(role) {

                selectedRole = role;

                roleSelection.classList.add("d-none");
                loginSection.classList.remove("d-none");

                roleLabel.textContent =
                `SECURE ${role.toUpperCase()} ACCESS`;

                resetLogin();
            }


            // Staff login selection
            staffRoleBtn.addEventListener("click", function () {

                if (isSubmitting) return;

                    showLogin("Staff");
            });


            // Owner login selection
            ownerRoleBtn.addEventListener("click", function () {

                if (isSubmitting) return;

                    showLogin("Owner");
            });


            // Return to role selection
            backToRoleBtn.addEventListener("click", function () {

                if (isSubmitting) return;

                    selectedRole = null;

                    loginSection.classList.add("d-none");
                    roleSelection.classList.remove("d-none");

                    resetLogin();
            });


            // ==========================================
            // STEP 8.5 – CLIENT-SIDE VALIDATION
            // STEP 8.6 – FLASK LOGIN API
            // ==========================================

            loginForm.addEventListener("submit", async function (event) {

                event.preventDefault();

                if (isSubmitting) return;

                    const username = usernameInput.value.trim();
                    const password = passwordInput.value;

                    // Clear previous errors
                    loginError.textContent = "";
                    loginError.classList.add("d-none");

                    usernameInput.classList.remove("is-invalid");
                    passwordInput.classList.remove("is-invalid");


                    // Validate username
                    if (username === "") {

                            usernameInput.classList.add("is-invalid");

                            showMessage("Please enter your username.");

                            usernameInput.focus();
                            return;
                        }


                        // Validate password
                        if (password.trim() === "") {

                                passwordInput.classList.add("is-invalid");

                                showMessage("Please enter your password.");

                                passwordInput.focus();
                                return;
                            }


                            // Validate selected role
                            if (selectedRole === null) {

                                    showMessage("Please select a login role.");
                                    return;
                                }


                                // ==========================================
                                // SEND LOGIN REQUEST TO FLASK
                                // ==========================================

                                isSubmitting = true;

                                signInBtn.disabled = true;
                                signInBtn.textContent = "Signing in...";

                                try {

                                    const response = await fetch("http://127.0.0.1:5000/api/auth/login", {

                                        method: "POST",

                                        headers: {
                                            "Content-Type": "application/json"
                                        },

                                        credentials: "same-origin",

                                        body: JSON.stringify({
                                                username: username,
                                                password: password
                                        })

                                });

                                const data = await response.json();


                                // ==========================================
                                // HANDLE FAILED LOGIN
                                // ==========================================


                                if (!response.ok || !data.success) {

                                        // Highlight credential fields for invalid login
                                        if (response.status === 401) {

                                                usernameInput.classList.add("is-invalid");
                                                passwordInput.classList.add("is-invalid");

                                                showMessage(
                                                    "Invalid username or password. Please try again."
                                                );

                                            } else {

                                                showMessage(
                                                    data.message || "Unable to process login."
                                                );

                                            }

                                            return;
                                        }


                                        // ==========================================
                                        // VERIFY ACCOUNT ROLE
                                        // ==========================================

                                        if (
                                                !data.user ||
                                                data.user.role !== selectedRole
                                            ) {

                                                // End the session created by Flask
                                                const logoutResponse = await fetch(
                                                    "/api/auth/logout",
                                                    {
                                                        method: "POST",
                                                        credentials: "same-origin"
                                                    }
                                                );

                                                if (!logoutResponse.ok) {
                                                        throw new Error(
                                                            "Unable to clear the mismatched session."
                                                        );
                                                    }

                                                    showMessage(
                                                        "This account does not match the selected role."
                                                    );

                                                    return;
                                                }


                                                // ==========================================
                                                // SUCCESSFUL LOGIN
                                                // ==========================================

                                                showMessage(
                                                    `Login successful. Welcome, ${data.user.name}!`,
                                                    "success"
                                                );

                                                // Clear password from the form
                                                passwordInput.value = "";

                                                // Role-based dashboard redirection
                                                // will be implemented in Step 8.8


                                                /* ==========================================
                                                STEP 8.8 – ROLE-BASED REDIRECTION
                                                ========================================== */

                                                // Redirect using the authenticated database role
                                                if (data.user.role === "Owner") {

                                                        window.location.replace(
                                                            "/frontend/owner-dashboard.html"
                                                        );

                                                    } else if (data.user.role === "Staff") {

                                                        window.location.replace(
                                                            "/frontend/staff-dashboard.html"
                                                        );

                                                    }

                                                } catch (error) {

                                                    console.error(
                                                        "Login request failed:",
                                                        error
                                                    );

                                                    showMessage(
                                                        "Unable to connect to the login service."
                                                    );

                                                } finally {

                                                    isSubmitting = false;

                                                    signInBtn.disabled = false;
                                                    signInBtn.textContent = "Sign in";

                                                }

                                        });

                                });
