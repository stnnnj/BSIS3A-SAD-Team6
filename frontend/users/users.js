
/* ==========================================
   CCMC RETAILFLOW – USER ACCOUNTS
   Step 10.3: Frontend API Integration
   ========================================== */

"use strict";

(() => {

    // ==========================================
    // 1. API CONFIGURATION
    // ==========================================

    const USERS_API = "/api/users";

    let users = [];

    const getElement = (id) =>
        document.getElementById(id);


    // ==========================================
    // 2. INITIALIZATION
    // ==========================================

    document.addEventListener("DOMContentLoaded", () => {

        initializeEvents();
        loadUsers();

    });


    function initializeEvents() {

        getElement("searchUsers")
            .addEventListener("input", filterUsers);

        getElement("filterRole")
            .addEventListener("change", filterUsers);

        getElement("filterStatus")
            .addEventListener("change", filterUsers);

        getElement("addUserForm")
            .addEventListener("submit", addUser);

        getElement("editUserForm")
            .addEventListener("submit", updateUser);

        getElement("addUserModal")
            .addEventListener("hidden.bs.modal", () => {

                getElement("addUserForm").reset();
                clearModalFeedback("addUserForm");

            });

        getElement("editUserModal")
            .addEventListener("hidden.bs.modal", () => {

                getElement("editUserForm").reset();
                clearModalFeedback("editUserForm");

            });

    }


    // ==========================================
    // 3. SHARED API REQUEST
    // ==========================================

    async function apiRequest(url, method = "GET", data = null) {

        const options = {
            method: method,
            credentials: "same-origin",
            headers: {
                "Accept": "application/json"
            }
        };

        if (data !== null) {

            options.headers["Content-Type"] =
                "application/json";

            options.body = JSON.stringify(data);

        }

        const response = await fetch(url, options);

        // Expired or missing session
        if (response.status === 401) {

            window.location.replace(
                "/frontend/index.html"
            );

            throw new Error("Authentication required.");

        }

        // Owner-only authorization
        if (response.status === 403) {

            throw new Error("Owner access required.");

        }

        const result = await response.json()
            .catch(() => null);

        if (!response.ok || !result?.success) {

            throw new Error(
                result?.message ||
                `Request failed (${response.status}).`
            );

        }

        return result;

    }


    // ==========================================
    // 4. LOAD USER ACCOUNTS
    // ==========================================

    async function loadUsers() {

        try {

            const result = await apiRequest(USERS_API);

            if (!Array.isArray(result.data?.users)) {

                throw new Error(
                    "Invalid user accounts response."
                );

            }

            users = result.data.users;

            updateSummaryCards();
            filterUsers();

        } catch (error) {

            users = [];

            showFeedback(error.message, "danger");

            renderEmptyTable(
                "Unable to load user accounts."
            );

            setText("totalAccounts", "—");
            setText("activeAccounts", "—");
            setText("inactiveAccounts", "—");
            setText("usersCount", "Data unavailable");

        }

    }


    // ==========================================
    // 5. SUMMARY CARDS
    // ==========================================

    function updateSummaryCards() {

        const total = users.length;

        const active = users.filter(
            user => isActive(user)
        ).length;

        const inactive = total - active;

        setText("totalAccounts", total);
        setText("activeAccounts", active);
        setText("inactiveAccounts", inactive);

    }


    // ==========================================
    // 6. SEARCH AND FILTER USERS
    // ==========================================

    function filterUsers() {

        const search = getElement("searchUsers")
            .value.trim().toLowerCase();

        const role = getElement("filterRole").value;

        const status = getElement("filterStatus").value;

        const filteredUsers = users.filter(user => {

            const name = String(
                user.name ?? ""
            ).toLowerCase();

            const username = String(
                user.username ?? ""
            ).toLowerCase();

            const matchesSearch =
                name.includes(search) ||
                username.includes(search);

            const matchesRole =
                role === "all" ||
                user.role === role;

            const matchesStatus =
                status === "all" ||
                (status === "active" && isActive(user)) ||
                (status === "inactive" && !isActive(user));

            return (
                matchesSearch &&
                matchesRole &&
                matchesStatus
            );

        });

        renderUsers(filteredUsers);

        setText(
            "usersCount",
            `Showing ${filteredUsers.length} of ${users.length} accounts`
        );

    }


    // ==========================================
    // 7. RENDER ACCOUNT DIRECTORY
    // ==========================================

    function renderUsers(userList) {

        const tableBody = getElement("usersTableBody");

        tableBody.replaceChildren();

        if (userList.length === 0) {

            renderEmptyTable(
                "No matching user accounts found."
            );

            return;

        }

        userList.forEach(user => {

            const row = document.createElement("tr");

            // USER ID
            appendCell(
                row,
                formatUserId(user.user_id)
            );

            // FULL NAME
            appendCell(row, user.name);

            // USERNAME
            appendCell(row, user.username);

            // ROLE BADGE
            const roleCell = document.createElement("td");

            const roleBadge = document.createElement("span");

            roleBadge.className =
                user.role === "Owner"
                    ? "user-role-badge user-role-owner"
                    : "user-role-badge user-role-staff";

            roleBadge.textContent = user.role;

            roleCell.appendChild(roleBadge);
            row.appendChild(roleCell);


            // STATUS BADGE
            const statusCell = document.createElement("td");

            const statusBadge = document.createElement("span");

            statusBadge.className =
                isActive(user)
                    ? "user-status-badge user-status-active"
                    : "user-status-badge user-status-inactive";

            statusBadge.textContent =
                isActive(user) ? "Active" : "Inactive";

            statusCell.appendChild(statusBadge);
            row.appendChild(statusCell);


            // DATE CREATED
            appendCell(
                row,
                formatDate(user.created_at)
            );


            // EDIT BUTTON
            const actionCell = document.createElement("td");

            const editButton = document.createElement("button");

            editButton.type = "button";

            editButton.className =
                "btn btn-outline-secondary btn-sm";

            editButton.textContent = "Edit";

            editButton.addEventListener("click", () => {

                openEditModal(user.user_id);

            });

            actionCell.appendChild(editButton);
            row.appendChild(actionCell);

            tableBody.appendChild(row);

        });

    }


    // ==========================================
    // 8. ADD USER
    // ==========================================

    async function addUser(event) {

        event.preventDefault();

        const button = getElement("saveNewUserBtn");

        if (button.disabled) return;

        clearModalFeedback("addUserForm");

        const userData = {

            name: getElement("addFullName")
                .value.trim(),

            username: getElement("addUsername")
                .value.trim(),

            password: getElement("addPassword").value,

            role: getElement("addRole").value,

            is_active: Number(
                getElement("addStatus").value
            )

        };

        const validationError =
            validateUser(userData, true);

        if (validationError) {

            showModalFeedback(
                "addUserForm",
                validationError
            );

            return;

        }

        setButtonLoading(button, true, "Saving...");

        try {

            const result = await apiRequest(
                USERS_API,
                "POST",
                userData
            );

            bootstrap.Modal.getOrCreateInstance(
                getElement("addUserModal")
            ).hide();

            event.target.reset();

            showFeedback(
                result.message ||
                "User account created successfully.",
                "success"
            );

            await loadUsers();

        } catch (error) {

            showModalFeedback(
                "addUserForm",
                error.message
            );

        } finally {

            setButtonLoading(button, false, "Save User");

        }

    }


    // ==========================================
    // 9. OPEN EDIT USER MODAL
    // ==========================================

    function openEditModal(userId) {

        const user = users.find(
            item => String(item.user_id) === String(userId)
        );

        if (!user) {

            showFeedback(
                "User account could not be found.",
                "danger"
            );

            return;

        }

        clearModalFeedback("editUserForm");

        getElement("editUserId").value = user.user_id;

        getElement("editFullName").value = user.name;

        getElement("editUsername").value = user.username;

        getElement("editRole").value = user.role;

        getElement("editStatus").value =
            isActive(user) ? "1" : "0";

        // Never retrieve or display an existing password.
        getElement("editPassword").value = "";

        getElement("editAccountReference").value =
            `${formatUserId(user.user_id)} · Created ${formatDate(user.created_at)}`;

        bootstrap.Modal.getOrCreateInstance(
            getElement("editUserModal")
        ).show();

    }


    // ==========================================
    // 10. UPDATE USER ACCOUNT
    // ==========================================

    async function updateUser(event) {

        event.preventDefault();

        const button = getElement("saveUserChangesBtn");

        if (button.disabled) return;

        clearModalFeedback("editUserForm");

        const userId = Number(
            getElement("editUserId").value
        );

        if (!Number.isInteger(userId) || userId <= 0) {

            showModalFeedback(
                "editUserForm",
                "Invalid user account."
            );

            return;

        }

        const userData = {

            name: getElement("editFullName")
                .value.trim(),

            username: getElement("editUsername")
                .value.trim(),

            role: getElement("editRole").value,

            is_active: Number(
                getElement("editStatus").value
            )

        };

        const newPassword =
            getElement("editPassword").value;

        // Only update the password when provided.
        if (newPassword !== "") {

            userData.new_password = newPassword;

        }

        const validationError =
            validateUser(userData, false);

        if (validationError) {

            showModalFeedback(
                "editUserForm",
                validationError
            );

            return;

        }

        const existingUser = users.find(
            user => Number(user.user_id) === userId
        );

        // Confirm an account deactivation.
        if (
            existingUser &&
            isActive(existingUser) &&
            userData.is_active === 0
        ) {

            const confirmed = window.confirm(
                "Deactivate this user account? " +
                "The user will no longer be permitted to sign in."
            );

            if (!confirmed) return;

        }

        setButtonLoading(
            button,
            true,
            "Saving..."
        );

        try {

            const result = await apiRequest(
                `${USERS_API}/${userId}`,
                "PUT",
                userData
            );

            bootstrap.Modal.getOrCreateInstance(
                getElement("editUserModal")
            ).hide();

            event.target.reset();

            showFeedback(
                result.message ||
                "User account updated successfully.",
                "success"
            );

            await loadUsers();

        } catch (error) {

            showModalFeedback(
                "editUserForm",
                error.message
            );

        } finally {

            setButtonLoading(
                button,
                false,
                "Save Changes"
            );

        }

    }


    // ==========================================
    // 11. FORM VALIDATION
    // ==========================================

    function validateUser(data, isNewUser) {

        if (!data.name || data.name.length > 100) {

            return "Enter a valid full name.";

        }

        if (
            !data.username ||
            data.username.length > 50
        ) {

            return "Enter a valid username.";

        }

        if (!/^[a-zA-Z0-9._-]+$/.test(data.username)) {

            return (
                "Username may only contain letters, " +
                "numbers, periods, underscores, and hyphens."
            );

        }

        if (!["Owner", "Staff"].includes(data.role)) {

            return "Please select a valid account role.";

        }

        if (![0, 1].includes(data.is_active)) {

            return "Please select a valid account status.";

        }

        const password = isNewUser
            ? data.password
            : data.new_password;

        if (isNewUser || password !== undefined) {

            if (
                typeof password !== "string" ||
                password.length < 8 ||
                password.length > 128 ||
                !password.trim()
            ) {

                return (
                    "Password must contain 8 to 128 characters."
                );

            }

        }

        return null;

    }


    // ==========================================
    // 12. PAGE FEEDBACK MESSAGES
    // ==========================================

    function showFeedback(message, type = "success") {

        const feedback = getElement("usersFeedback");

        feedback.className = `alert alert-${type}`;

        feedback.textContent = message;

    }


    // ==========================================
    // 13. MODAL FEEDBACK MESSAGES
    // ==========================================

    function showModalFeedback(formId, message) {

        const form = getElement(formId);

        let feedback = form.querySelector(
            ".user-form-feedback"
        );

        if (!feedback) {

            feedback = document.createElement("div");

            feedback.className =
                "alert alert-danger user-form-feedback";

            feedback.setAttribute("role", "alert");

            form.querySelector(".modal-body")
                .prepend(feedback);

        }

        feedback.textContent = message;

    }


    function clearModalFeedback(formId) {

        const feedback = getElement(formId)
            .querySelector(".user-form-feedback");

        if (feedback) {

            feedback.remove();

        }

    }


    // ==========================================
    // 14. TABLE HELPERS
    // ==========================================

    function appendCell(row, value) {

        const cell = document.createElement("td");

        cell.textContent = value ?? "—";

        row.appendChild(cell);

    }


    function renderEmptyTable(message) {

        const tableBody = getElement("usersTableBody");

        tableBody.replaceChildren();

        const row = document.createElement("tr");

        const cell = document.createElement("td");

        cell.colSpan = 7;

        cell.className =
            "text-center text-secondary py-5";

        cell.textContent = message;

        row.appendChild(cell);
        tableBody.appendChild(row);

    }


    // ==========================================
    // 15. FORMATTING HELPERS
    // ==========================================

    function isActive(user) {

        return Number(user.is_active) === 1;

    }


    function formatUserId(userId) {

        return `U-${String(userId).padStart(3, "0")}`;

    }


    function formatDate(value) {

        if (!value) return "—";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {

            return "—";

        }

        return date.toLocaleDateString("en-PH", {

            year: "numeric",
            month: "short",
            day: "2-digit"

        });

    }


    function setText(id, value) {

        const element = getElement(id);

        if (element) {

            element.textContent = value;

        }

    }


    function setButtonLoading(button, loading, label) {

        button.disabled = loading;
        button.textContent = label;

    }

})();
